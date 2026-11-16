import { describe, expect, it } from "vitest";
import { D, parseDecimalFr } from "@/lib/decimal";
import { resolveAmounts, validateFillup, isProbableDuplicate } from "@/domain/fillup-entry";
import { splitAllocation, savingsCapacity, transferable } from "@/domain/savings";
import { canTransition, BLOCKING_STATES } from "@/domain/payment-state";
import { simulate } from "@/domain/simulation";

describe("Saisie française", () => {
  it("accepte la virgule décimale et les espaces", () => {
    expect(parseDecimalFr("0,90")!.toString()).toBe("0.9");
    expect(parseDecimalFr("1 234,56 €")!.toString()).toBe("1234.56");
    expect(parseDecimalFr("1.234,5")!.toString()).toBe("1234.5");
    expect(parseDecimalFr("abc")).toBeNull();
    expect(parseDecimalFr("")).toBeNull();
  });
});

describe("Deux valeurs sur trois", () => {
  it("calcule le total", () => {
    const r = resolveAmounts({ liters: D(45), unitPrice: D("0.90") });
    expect(r.ok && r.total.toString()).toBe("40.5");
    expect(r.ok && r.computed).toBe("total");
  });
  it("calcule les litres", () => {
    const r = resolveAmounts({ total: D("40.50"), unitPrice: D("0.90") });
    expect(r.ok && r.liters.toString()).toBe("45");
  });
  it("calcule le prix unitaire", () => {
    const r = resolveAmounts({ total: D("40.50"), liters: D(45) });
    expect(r.ok && r.unitPrice.toString()).toBe("0.9");
  });
  it("trois valeurs divergentes : demande laquelle corriger", () => {
    const r = resolveAmounts({ total: D("42"), liters: D(45), unitPrice: D("0.90") });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === "MISMATCH") {
      expect(r.candidates.total.toString()).toBe("40.5");
      expect(r.message).toContain("Quelle valeur");
    } else throw new Error("attendu MISMATCH");
  });
  it("tolère les écarts d'arrondi et conserve la remise", () => {
    expect(resolveAmounts({ total: D("40.52"), liters: D(45), unitPrice: D("0.90") }).ok).toBe(true);
    const r = resolveAmounts({ total: D("38.50"), liters: D(45), unitPrice: D("0.90"), discount: D(2) });
    expect(r.ok && r.discount.toString()).toBe("2");
  });
});

describe("Validation d'un plein", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  it("refuse une date future et des litres nuls", () => {
    const issues = validateFillup({ occurredAt: new Date("2026-12-01"), odometerKm: D(1), liters: D(0), now });
    expect(issues.map((i) => i.code)).toEqual(["FUTURE_DATE", "LITERS_NOT_POSITIVE"]);
  });
  it("compteur non croissant : confirmable, pas bloquant", () => {
    const issues = validateFillup({ occurredAt: now, odometerKm: D(100), liters: D(10), previous: { occurredAt: now, odometerKm: D(200) }, now });
    expect(issues[0].level).toBe("confirmable");
  });
  it("doublon probable détecté", () => {
    expect(isProbableDuplicate({ occurredAt: now, total: D(40), odometerKm: D(1000) }, { occurredAt: new Date(now.getTime() + 60000), total: D(40), odometerKm: D(1000) })).toBe(true);
  });
});

describe("Recette H — répartition des gains entre projets", () => {
  it("gain 50 €, 60 % / 40 % : 30 / 20, jamais 50 / 50", () => {
    const lines = splitAllocation(D(50), [{ projectId: "A", percent: D(60) }, { projectId: "B", percent: D(40) }]);
    expect(lines.map((l) => [l.projectId, l.amount.toString()])).toEqual([["A", "30"], ["B", "20"]]);
  });
  it("répartition au centime sans création d'argent", () => {
    const lines = splitAllocation(D(10), ["A", "B", "C"].map((projectId) => ({ projectId, percent: D(100).div(3) })));
    const s = lines.reduce((a, l) => a.plus(l.amount), D(0));
    expect(s.toString()).toBe("10");
    expect(lines.map((l) => l.amount.toString()).sort()).toEqual(["3.33", "3.33", "3.34"]);
    // somme des pourcentages < 100 : le reste n'est pas affecté
    const partial = splitAllocation(D(10), [{ projectId: "A", percent: D(30) }]);
    expect(partial[0].amount.toString()).toBe("3");
  });
  it("perte suivante de 10 € : capacité réduite, aucun virement repris", () => {
    const c = savingsCapacity({ calculatedGains: D(40), conversionCost: D(0), deductConversion: true, alreadyAllocated: D(50) });
    expect(c.capacity.toString()).toBe("0");
    expect(c.deficit.toString()).toBe("10");
    expect(c.message).toContain("Capacité réduite");
  });
  it("déduit la conversion avant affectation si l'option est active", () => {
    expect(savingsCapacity({ calculatedGains: D(400), conversionCost: D(360), deductConversion: true, alreadyAllocated: D(0) }).capacity.toString()).toBe("40");
    expect(savingsCapacity({ calculatedGains: D(400), conversionCost: D(360), deductConversion: false, alreadyAllocated: D(0) }).capacity.toString()).toBe("400");
  });
  it("versement possible = affecté − déclaré − confirmé − en vol", () => {
    expect(transferable({ allocated: D(30), declaredManual: D(10), bankConfirmed: D(5), inFlight: D(5) }).toString()).toBe("10");
    expect(transferable({ allocated: D(10), declaredManual: D(10), bankConfirmed: D(5), inFlight: D(0) }).toString()).toBe("0");
  });
});

describe("Machine d'états des virements", () => {
  it("interdit de revenir d'un état terminal", () => {
    expect(canTransition("confirmed", "pending")).toBe(false);
    expect(canTransition("unknown", "confirmed")).toBe(true);
    expect(canTransition("draft", "confirmed")).toBe(false);
    expect(BLOCKING_STATES).toContain("unknown");
  });
});

describe("Simulation multi-énergies", () => {
  it("coût kilométrique commun sans mélanger litres et kWh", () => {
    const ev = simulate({ id: "ev", label: "EV", energy: "electrique", annualKm: D(10000), years: D(1), electric: { kwh100Vehicle: D(15), chargingLosses: D("0.10"), pricePerKwh: D("0.20") } });
    expect(ev.kwhBilledPerYear!.toString()).toBe("1650");
    expect(ev.litersPerYear).toBeNull();
    expect(ev.energyCostPerKm.toString()).toBe("0.033");
    const phev = simulate({ id: "p", label: "PHEV", energy: "hybride_rechargeable", annualKm: D(10000), years: D(1), electricShare: D("0.5"), thermal: { l100: D(6), pricePerL: D("1.80") }, electric: { kwh100Vehicle: D(18), chargingLosses: D(0), pricePerKwh: D("0.25") } });
    expect(phev.litersPerYear!.toString()).toBe("300");
    expect(phev.kwhBilledPerYear!.toString()).toBe("900");
    expect(phev.energyCostPerYear.toString()).toBe("765");
  });
  it("charge gratuite : coût énergie nul", () => {
    const ev = simulate({ id: "ev", label: "EV", energy: "electrique", annualKm: D(1000), years: D(1), electric: { kwh100Vehicle: D(15), chargingLosses: D(0), pricePerKwh: D(0) } });
    expect(ev.energyCostPerYear.toString()).toBe("0");
  });
});
