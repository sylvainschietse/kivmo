import { describe, expect, it } from "vitest";
import { D } from "@/lib/decimal";
import { analyzeConsumption, averageConsumption, consumptionHeadline } from "@/domain/consumption";
import { compareInterval, computeAmortization, type ReferenceProfileInput } from "@/domain/comparison";
import { estimateE85, evaluateDetour, crowFliesKm } from "@/domain/estimates";
import type { FillupInput } from "@/domain/types";
import { monthlyAggregates, prorateByMonth } from "@/domain/aggregates";
import { formatMoney } from "@/lib/format";

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 10));
const f = (id: string, n: number, odo: number, full: boolean, liters: number | string, amount: number | string, extra: Partial<FillupInput> = {}): FillupInput => ({
  id,
  occurredAt: day(n),
  odometerKm: D(odo),
  isFull: full,
  lines: [{ fuel: "E85", liters: D(liters), amountPaid: D(amount) }],
  ...extra,
});

const dieselRef: ReferenceProfileInput = {
  id: "ref1",
  version: 1,
  effectiveFrom: day(1),
  consumptionL100: D(6),
  fuel: "GAZOLE",
  priceMode: "fixed",
  fixedPrice: D("1.70"),
};

describe("Recette A — repère et premier intervalle", () => {
  const fillups = [f("A", 1, 10000, true, 40, 36), f("B", 10, 10600, true, 45, "40.50")];
  const a = analyzeConsumption(fillups);
  const it0 = a.intervals[0];

  it("mesure 600 km, 7,5 L/100 et 6,75 €/100", () => {
    expect(a.intervals).toHaveLength(1);
    expect(it0.distanceKm.toString()).toBe("600");
    expect(it0.volumeL.toString()).toBe("45");
    expect(it0.consumptionL100!.toString()).toBe("7.5");
    expect(it0.costPer100!.toString()).toBe("6.75");
    expect(it0.includedFillupIds).toEqual(["B"]);
  });

  it("compare à la référence diesel : 61,20 € et gain 20,70 €", () => {
    const c = compareInterval(it0, new Map(fillups.map((x) => [x.id, x])), [dieselRef]);
    expect(c.status).toBe("complete");
    expect(c.referenceCost!.toString()).toBe("61.2");
    expect(c.gain!.toString()).toBe("20.7");
  });

  it("avec conversion 360 € : net −339,30 €, reste 339,30 €, non amorti", () => {
    const c = compareInterval(it0, new Map(fillups.map((x) => [x.id, x])), [dieselRef]);
    const am = computeAmortization(a.intervals, [c], { cost: D(360), date: day(1), odometerKm: D(10000) });
    expect(am.netAfterConversion.toString()).toBe("-339.3");
    expect(am.remainingToAmortize.toString()).toBe("339.3");
    expect(am.currentlyAmortized).toBe(false);
    expect(am.initialAmortizedAt).toBeNull();
    expect(formatMoney(am.netAfterConversion)).toBe("−339,30 €");
  });
});

describe("Recette B — plein partiel intermédiaire", () => {
  const fillups = [f("A", 1, 10000, true, 40, 36), f("P", 5, 10250, false, 20, 18), f("B", 10, 10600, true, 25, "22.50")];
  const a = analyzeConsumption(fillups);
  it("donne le même résultat que A sans compter les litres du repère", () => {
    const i = a.intervals[0];
    expect(i.distanceKm.toString()).toBe("600");
    expect(i.volumeL.toString()).toBe("45");
    expect(i.cost.toString()).toBe("40.5");
    expect(i.consumptionL100!.toString()).toBe("7.5");
    expect(i.includedFillupIds).toEqual(["P", "B"]);
    const c = compareInterval(i, new Map(fillups.map((x) => [x.id, x])), [dieselRef]);
    expect(c.gain!.toString()).toBe("20.7");
  });
});

describe("Recette C — estimation avant données réelles", () => {
  const e = estimateE85({
    gasolineL100: D(6),
    gasolinePrice: D("1.85"),
    overconsumption: D("0.25"),
    e85Price: D("0.90"),
    conversionCost: D(360),
  });
  it("coûts 11,10 et 6,75 €/100, gain 4,35 €/100, amortissement vers 8 276 km", () => {
    expect(e.kind).toBe("estimation");
    expect(e.e85L100.toString()).toBe("7.5");
    expect(e.gasolineCostPer100.toString()).toBe("11.1");
    expect(e.e85CostPer100.toString()).toBe("6.75");
    expect(e.gainPer100.toString()).toBe("4.35");
    expect(e.amortizationKm!.toDecimalPlaces(0).toString()).toBe("8276");
    expect(e.e85BreakEvenPrice.toString()).toBe("1.48");
  });
  it("aucun amortissement si gain par km ≤ 0", () => {
    const e2 = estimateE85({ gasolineL100: D(6), gasolinePrice: D("1.10"), overconsumption: D("0.25"), e85Price: D("0.90"), conversionCost: D(360) });
    expect(e2.amortizationKm).toBeNull();
    expect(e2.message).toContain("pas d'amortissement prévu");
  });
});

describe("Recette D — détour", () => {
  const r = evaluateDetour({
    plannedVolumeL: D(40),
    baselinePrice: D("0.95"),
    detourPrice: D("0.90"),
    extraKm: D(12),
    consumptionL100: D("7.5"),
    fuelPriceForDetour: D("0.90"),
  });
  it("gain brut 2 €, coût 0,81 €, net 1,19 €", () => {
    expect(r.grossGain.toString()).toBe("2");
    expect(r.detourFuelCost.toString()).toBe("0.81");
    expect(r.netGain.toString()).toBe("1.19");
    expect(r.breakEvenVolumeL!.toString()).toBe("16.2");
    expect(r.worthIt).toBe(true);
  });
  it("différence nulle ou négative : pas d'intérêt lié au prix", () => {
    const r2 = evaluateDetour({ plannedVolumeL: D(40), baselinePrice: D("0.90"), detourPrice: D("0.92"), extraKm: D(5), consumptionL100: D(7), fuelPriceForDetour: D("0.9") });
    expect(r2.breakEvenVolumeL).toBeNull();
    expect(r2.worthIt).toBe(false);
  });
});

describe("Recette E — absence de repère, prix manquant, compteur identique", () => {
  it("sans plein complet : aucune consommation mesurée et message précis", () => {
    const a = analyzeConsumption([f("P1", 1, 10000, false, 20, 18), f("P2", 3, 10300, false, 20, 18)]);
    expect(a.intervals).toHaveLength(0);
    expect(a.baselineFillupId).toBeNull();
    expect(consumptionHeadline(a)).toContain("Données insuffisantes");
  });
  it("premier plein complet seul : point de départ", () => {
    const a = analyzeConsumption([f("A", 1, 10000, true, 40, 36)]);
    expect(consumptionHeadline(a)).toContain("Premier plein : point de départ enregistré");
  });
  it("compteur identique : intervalle invalide, aucune consommation", () => {
    const a = analyzeConsumption([f("A", 1, 10000, true, 40, 36), f("B", 2, 10000, true, 10, 9)]);
    expect(a.intervals[0].status).toBe("invalid");
    expect(a.intervals[0].consumptionL100).toBeNull();
    const c = compareInterval(a.intervals[0], new Map(), [dieselRef]);
    expect(c.gain).toBeNull();
    expect(c.status).toBe("incomplete");
  });
  it("prix de référence manquant en mode observé : comparaison incomplète, jamais zéro", () => {
    const fl = [f("A", 1, 10000, true, 40, 36), f("B", 10, 10600, true, 45, "40.50")];
    const a = analyzeConsumption(fl);
    const c = compareInterval(a.intervals[0], new Map(fl.map((x) => [x.id, x])), [{ ...dieselRef, priceMode: "observed", fixedPrice: null }]);
    expect(c.status).toBe("incomplete");
    expect(c.gain).toBeNull();
    expect(c.missingReason).toContain("Comparaison incomplète");
  });
});

describe("Prix de référence moyen pondéré par les litres", () => {
  it("pondère les instantanés par litres achetés", () => {
    const snap = (p: string) => ({ fuel: "GAZOLE" as const, price: D(p), source: "test", observedAt: null });
    const fl = [
      f("A", 1, 10000, true, 40, 36, { referencePrice: snap("1.60") }),
      f("P", 5, 10250, false, 30, 27, { referencePrice: snap("1.60") }),
      f("B", 10, 10600, true, 10, 9, { referencePrice: snap("2.00") }),
    ];
    const a = analyzeConsumption(fl);
    const c = compareInterval(a.intervals[0], new Map(fl.map((x) => [x.id, x])), [{ ...dieselRef, priceMode: "observed" }]);
    // (30×1,60 + 10×2,00) / 40 = 1,70 → 600 × 6 / 100 × 1,70 = 61,20
    expect(c.referencePrice!.toString()).toBe("1.7");
    expect(c.referenceCost!.toString()).toBe("61.2");
  });
});

describe("Mélange, oubli, versions de référence", () => {
  it("additionne plusieurs lignes carburant d'un même événement", () => {
    const fl: FillupInput[] = [
      f("A", 1, 10000, true, 40, 36),
      { id: "B", occurredAt: day(10), odometerKm: D(10600), isFull: true, lines: [
        { fuel: "E85", liters: D(35), amountPaid: D("31.50") },
        { fuel: "SP95_E10", liters: D(10), amountPaid: D("18.50") },
      ] },
    ];
    const i = analyzeConsumption(fl).intervals[0];
    expect(i.volumeL.toString()).toBe("45");
    expect(i.cost.toString()).toBe("50");
    expect(i.litersByFuel.E85!.toString()).toBe("35");
    expect(i.litersByFuel.SP95_E10!.toString()).toBe("10");
  });
  it("plein oublié déclaré : intervalle suspect, exclu de la moyenne", () => {
    const fl = [f("A", 1, 10000, true, 40, 36), f("B", 10, 10600, true, 20, 18, { missedBefore: true }), f("C", 20, 11200, true, 45, "40.5")];
    const a = analyzeConsumption(fl);
    expect(a.intervals[0].status).toBe("suspect");
    expect(a.intervals[0].issues).toContain("MISSED_FILLUP_DECLARED");
    expect(averageConsumption(a.intervals)!.toString()).toBe("7.5");
  });
  it("consommation artificiellement faible signalée comme suspecte", () => {
    const a = analyzeConsumption([f("A", 1, 10000, true, 40, 36), f("B", 10, 11000, true, 10, 9)]);
    expect(a.intervals[0].status).toBe("suspect");
  });
  it("nouveau repère : la séquence interrompue n'est pas mesurée", () => {
    const a = analyzeConsumption([f("A", 1, 10000, true, 40, 36), f("P", 5, 10300, false, 20, 18), f("N", 10, 10900, true, 45, 40, { startsNewBaseline: true }), f("C", 20, 11500, true, 45, "40.5")]);
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0].startFillupId).toBe("N");
    expect(a.unmeasuredFillupIds).toContain("P");
  });
  it("moyenne = volume total / distance totale (pas moyenne des ratios)", () => {
    const a = analyzeConsumption([f("A", 1, 10000, true, 40, 36), f("B", 10, 10100, true, 10, 9), f("C", 20, 11000, true, 54, 48)]);
    // 10/100 = 10 L/100 ; 54/900 = 6 L/100 ; moyenne simple = 8 ; pondérée = 64/1000 = 6,4
    expect(averageConsumption(a.intervals)!.toString()).toBe("6.4");
  });
  it("applique la version de référence en vigueur à la date de fermeture", () => {
    const fl = [f("A", 1, 10000, true, 40, 36), f("B", 10, 10600, true, 45, "40.50"), f("C", 20, 11200, true, 45, "40.50")];
    const a = analyzeConsumption(fl);
    const v2: ReferenceProfileInput = { ...dieselRef, id: "ref2", version: 2, effectiveFrom: day(15), consumptionL100: D(7) };
    const map = new Map(fl.map((x) => [x.id, x]));
    expect(compareInterval(a.intervals[0], map, [dieselRef, v2]).profileVersion).toBe(1);
    expect(compareInterval(a.intervals[1], map, [dieselRef, v2]).profileVersion).toBe(2);
  });
});

describe("Recette N — économie négative et amortissement", () => {
  it("les gains négatifs réduisent le total, seul le reste à amortir est borné", () => {
    const fl = [f("A", 1, 10000, true, 40, 36), f("B", 10, 10600, true, 45, "40.50"), f("C", 20, 11200, true, 45, 70)];
    const a = analyzeConsumption(fl, { plausibleMaxL100: D(30) });
    const map = new Map(fl.map((x) => [x.id, x]));
    const cmps = a.intervals.map((i) => compareInterval(i, map, [dieselRef]));
    expect(cmps[1].gain!.toString()).toBe("-8.8");
    const am = computeAmortization(a.intervals, cmps, null);
    expect(am.cumulativeGain.toString()).toBe("11.9");
    const am2 = computeAmortization(a.intervals, cmps, { cost: D(5), date: day(1), odometerKm: D(10000) });
    expect(am2.initialAmortizedAt).toEqual(day(10));
    expect(am2.currentlyAmortized).toBe(true);
    const am3 = computeAmortization(a.intervals, cmps, { cost: D(15), date: day(1), odometerKm: D(10000) });
    expect(am3.initialAmortizedAt).toEqual(day(10));
    expect(am3.currentlyAmortized).toBe(false);
    expect(am3.netAfterConversion.toString()).toBe("-3.1");
  });
  it("intervalle à cheval sur la conversion : signalé, exclu", () => {
    const fl = [f("A", 1, 10000, true, 40, 36), f("B", 10, 10600, true, 45, "40.50")];
    const a = analyzeConsumption(fl);
    const am = computeAmortization(a.intervals, [compareInterval(a.intervals[0], new Map(fl.map((x) => [x.id, x])), [dieselRef])], { cost: D(360), date: day(5), odometerKm: D(10300) });
    expect(am.straddlingIntervalIds).toEqual(["B"]);
    expect(am.cumulativeGain.toString()).toBe("0");
  });
});

describe("Agrégats et arrondis", () => {
  it("dépenses par date d'achat, mesures par date de fermeture", () => {
    const fl = [f("A", 1, 10000, true, 40, 36), { ...f("B", 10, 10600, true, 45, "40.50"), occurredAt: new Date(Date.UTC(2026, 10, 2)) }];
    const a = analyzeConsumption(fl);
    const cmps = a.intervals.map((i) => compareInterval(i, new Map(fl.map((x) => [x.id, x])), [dieselRef]));
    const rows = monthlyAggregates(fl.map((x) => ({ occurredAt: x.occurredAt, total: x.lines[0].amountPaid, liters: x.lines[0].liters })), a.intervals, cmps);
    expect(rows.map((r) => r.month)).toEqual(["2026-10", "2026-11"]);
    expect(rows[0].spend.toString()).toBe("36");
    expect(rows[0].measuredGain).toBeNull();
    expect(rows[1].measuredGain!.toString()).toBe("20.7");
  });
  it("le total provient des valeurs non arrondies", () => {
    const parts = [D("0.333"), D("0.333"), D("0.333")];
    const total = parts.reduce((a, b) => a.plus(b));
    expect(formatMoney(total)).toBe("1,00 €");
    expect(parts.map((p) => formatMoney(p))).toEqual(["0,33 €", "0,33 €", "0,33 €"]);
  });
  it("proratisation sur plusieurs mois", () => {
    const m = prorateByMonth(new Date(Date.UTC(2026, 9, 31, 0)), new Date(Date.UTC(2026, 10, 2, 0)), D(20), "UTC");
    expect(m.get("2026-10")!.toString()).toBe("10");
    expect(m.get("2026-11")!.toString()).toBe("10");
  });
  it("distance à vol d'oiseau Paris–Lyon ≈ 391 km", () => {
    expect(Math.round(crowFliesKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.764, lng: 4.8357 }))).toBe(391);
  });
});
