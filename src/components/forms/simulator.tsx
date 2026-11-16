"use client";

import { useMemo, useState } from "react";
import { D, parseDecimalFr } from "@/lib/decimal";
import { formatMoney, formatKm, formatUnitPrice } from "@/lib/format";
import { estimateE85 } from "@/domain/estimates";
import { simulate, ENERGY_LABELS, type Energy, type SimulationScenario } from "@/domain/simulation";
import { Field, Input, Notice, Select, Table } from "@/components/ui";

const n = (s: string) => {
  try {
    return s.trim() ? parseDecimalFr(s) : null;
  } catch {
    return null;
  }
};

type Price = { value: string; label: string } | null;

export function E85Simulator({ defaults, gasolinePrice, e85Price }: { defaults: { l100: string; over: string; conv: string; km: string }; gasolinePrice: Price; e85Price: Price }) {
  const [l100, setL100] = useState(defaults.l100);
  const [over, setOver] = useState(defaults.over);
  const [e85L100, setE85L100] = useState("");
  const [gp, setGp] = useState(gasolinePrice?.value ?? "");
  const [ep, setEp] = useState(e85Price?.value ?? "");
  const [conv, setConv] = useState(defaults.conv);
  const [km, setKm] = useState(defaults.km);
  const r = useMemo(() => {
    const a = n(l100), b = n(gp), c = n(ep), d = n(conv), o = n(over);
    if (!a || !b || !c || d == null || o == null) return null;
    return estimateE85({ gasolineL100: a, gasolinePrice: b, e85Price: c, conversionCost: d, overconsumption: o.div(100), e85L100: n(e85L100), annualKm: n(km) });
  }, [l100, gp, ep, conv, over, e85L100, km]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Essence prévue (L/100 km)" htmlFor="s-l100"><Input id="s-l100" inputMode="decimal" value={l100} onChange={(e) => setL100(e.target.value)} /></Field>
        <Field label="Surconsommation E85 (%)" htmlFor="s-over" hint="Hypothèse, remplacée par vos mesures"><Input id="s-over" inputMode="decimal" value={over} onChange={(e) => setOver(e.target.value)} /></Field>
        <Field label="ou consommation E85 (L/100)" htmlFor="s-e85l"><Input id="s-e85l" inputMode="decimal" value={e85L100} onChange={(e) => setE85L100(e.target.value)} /></Field>
        <Field label="Kilométrage annuel" htmlFor="s-km"><Input id="s-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
        <Field label="Prix essence (€/L)" htmlFor="s-gp" hint={gasolinePrice?.label ?? "À saisir : aucun prix daté disponible"}><Input id="s-gp" inputMode="decimal" value={gp} onChange={(e) => setGp(e.target.value)} /></Field>
        <Field label="Prix E85 (€/L)" htmlFor="s-ep" hint={e85Price?.label ?? "À saisir : aucun prix daté disponible"}><Input id="s-ep" inputMode="decimal" value={ep} onChange={(e) => setEp(e.target.value)} /></Field>
        <Field label="Coût de conversion (€)" htmlFor="s-conv"><Input id="s-conv" inputMode="decimal" value={conv} onChange={(e) => setConv(e.target.value)} /></Field>
      </div>
      {!r ? (
        <Notice tone="info">Renseignez les prix pour obtenir l&apos;estimation.</Notice>
      ) : (
        <div aria-live="polite" className="rounded-2xl bg-surface-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-warn">Estimation, pas une mesure</p>
          <dl className="num mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Essence / 100 km</dt><dd className="font-semibold">{formatMoney(r.gasolineCostPer100)}</dd></div>
            <div><dt className="text-muted">E85 / 100 km</dt><dd className="font-semibold">{formatMoney(r.e85CostPer100)} ({r.e85L100.toFixed(2).replace(".", ",")} L)</dd></div>
            <div><dt className="text-muted">Écart / 100 km</dt><dd className={`font-semibold ${r.gainPer100.lt(0) ? "text-loss" : "text-green"}`}>{formatMoney(r.gainPer100)}</dd></div>
            <div><dt className="text-muted">Prix E85 d&apos;équilibre</dt><dd className="font-semibold">{formatUnitPrice(r.e85BreakEvenPrice)}</dd></div>
            <div className="col-span-2"><dt className="text-muted">Amortissement prévisionnel</dt><dd className="font-semibold">{r.amortizationKm ? `${formatKm(r.amortizationKm)}${r.amortizationMonths ? ` · environ ${r.amortizationMonths.toFixed(1).replace(".", ",")} mois` : ""}` : "Pas d'amortissement prévu avec ces hypothèses"}</dd></div>
          </dl>
          <p className="mt-2 text-sm">{r.message}</p>
        </div>
      )}
    </div>
  );
}

type Row = { id: string; label: string; energy: Energy; l100: string; price: string; kwh100: string; losses: string; kwhPrice: string; share: string; purchase: string; resale: string; conversion: string; maintenance: string; insurance: string; charger: string };
const blank = (i: number, energy: Energy): Row => ({ id: String(i), label: `${ENERGY_LABELS[energy]}`, energy, l100: "", price: "", kwh100: "", losses: "10", kwhPrice: "", share: "", purchase: "", resale: "", conversion: "", maintenance: "", insurance: "", charger: "" });

export function TcoSimulator() {
  const [years, setYears] = useState("5");
  const [km, setKm] = useState("15000");
  const [rows, setRows] = useState<Row[]>([blank(1, "essence"), blank(2, "e85"), blank(3, "electrique")]);
  const upd = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const results = rows.map((r) => {
    const sc: SimulationScenario = {
      id: r.id, label: r.label, energy: r.energy, annualKm: n(km) ?? D(0), years: n(years) ?? D(1),
      thermal: n(r.l100) && n(r.price) ? { l100: n(r.l100)!, pricePerL: n(r.price)! } : null,
      electric: n(r.kwh100) && n(r.kwhPrice) != null ? { kwh100Vehicle: n(r.kwh100)!, chargingLosses: (n(r.losses) ?? D(0)).div(100), pricePerKwh: n(r.kwhPrice)! } : null,
      electricShare: n(r.share)?.div(100) ?? null,
      purchasePrice: n(r.purchase), resaleValue: n(r.resale), conversionCost: n(r.conversion), maintenancePerYear: n(r.maintenance), insurancePerYear: n(r.insurance), chargerInstallCost: n(r.charger),
    };
    return simulate(sc);
  });
  const isThermal = (e: Energy) => e !== "electrique";
  const isElec = (e: Energy) => e === "electrique" || e === "hybride_rechargeable";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Field label="Durée (ans)" htmlFor="t-years"><Input id="t-years" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} /></Field>
        <Field label="Km par an" htmlFor="t-km"><Input id="t-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {rows.map((r, i) => (
          <fieldset key={r.id} className="space-y-2 rounded-2xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Scénario {i + 1}</legend>
            <Field label="Énergie" htmlFor={`e-${i}`}><Select id={`e-${i}`} value={r.energy} onChange={(e) => { upd(i, "energy", e.target.value); upd(i, "label", ENERGY_LABELS[e.target.value as Energy]); }}>{Object.entries(ENERGY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            {isThermal(r.energy) && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="L/100 km" htmlFor={`l-${i}`}><Input id={`l-${i}`} inputMode="decimal" value={r.l100} onChange={(e) => upd(i, "l100", e.target.value)} /></Field>
                <Field label="€/L" htmlFor={`p-${i}`}><Input id={`p-${i}`} inputMode="decimal" value={r.price} onChange={(e) => upd(i, "price", e.target.value)} /></Field>
              </div>
            )}
            {isElec(r.energy) && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="kWh/100 km (véhicule)" htmlFor={`k-${i}`}><Input id={`k-${i}`} inputMode="decimal" value={r.kwh100} onChange={(e) => upd(i, "kwh100", e.target.value)} /></Field>
                <Field label="Pertes de charge (%)" htmlFor={`lo-${i}`}><Input id={`lo-${i}`} inputMode="decimal" value={r.losses} onChange={(e) => upd(i, "losses", e.target.value)} /></Field>
                <Field label="€/kWh facturé" htmlFor={`kp-${i}`}><Input id={`kp-${i}`} inputMode="decimal" value={r.kwhPrice} onChange={(e) => upd(i, "kwhPrice", e.target.value)} /></Field>
                {r.energy === "hybride_rechargeable" && <Field label="Part électrique (%)" htmlFor={`sh-${i}`}><Input id={`sh-${i}`} inputMode="decimal" value={r.share} onChange={(e) => upd(i, "share", e.target.value)} /></Field>}
                {r.energy === "electrique" && <Field label="Borne (€)" htmlFor={`ch-${i}`}><Input id={`ch-${i}`} inputMode="decimal" value={r.charger} onChange={(e) => upd(i, "charger", e.target.value)} /></Field>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Achat (€)" htmlFor={`pu-${i}`}><Input id={`pu-${i}`} inputMode="decimal" value={r.purchase} onChange={(e) => upd(i, "purchase", e.target.value)} /></Field>
              <Field label="Revente (€)" htmlFor={`re-${i}`}><Input id={`re-${i}`} inputMode="decimal" value={r.resale} onChange={(e) => upd(i, "resale", e.target.value)} /></Field>
              <Field label="Conversion (€)" htmlFor={`co-${i}`}><Input id={`co-${i}`} inputMode="decimal" value={r.conversion} onChange={(e) => upd(i, "conversion", e.target.value)} /></Field>
              <Field label="Entretien / an (€)" htmlFor={`m-${i}`}><Input id={`m-${i}`} inputMode="decimal" value={r.maintenance} onChange={(e) => upd(i, "maintenance", e.target.value)} /></Field>
              <Field label="Assurance / an (€)" htmlFor={`in-${i}`}><Input id={`in-${i}`} inputMode="decimal" value={r.insurance} onChange={(e) => upd(i, "insurance", e.target.value)} /></Field>
            </div>
          </fieldset>
        ))}
      </div>
      <Table
        caption="Estimations : litres et kWh sont calculés séparément ; les kWh facturés incluent les pertes de charge."
        head={["Scénario", "Énergie / an", "Coûts fixes", "Total", "€/km", "Avertissements"]}
        rows={results.map((r) => [r.label, formatMoney(r.energyCostPerYear), formatMoney(r.fixedCosts), <strong key="t">{formatMoney(r.totalCost)}</strong>, formatUnitPrice(r.costPerKm).replace("/L", "/km"), r.warnings.join(" ") || "—"])}
      />
    </div>
  );
}
