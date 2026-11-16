"use client";

import { useMemo, useState } from "react";
import { parseDecimalFr } from "@/lib/decimal";
import { evaluateDetour } from "@/domain/estimates";
import { formatLiters, formatMoney } from "@/lib/format";
import { Field, Input, Notice } from "@/components/ui";

const n = (s: string) => {
  try {
    return s.trim() ? parseDecimalFr(s) : null;
  } catch {
    return null;
  }
};

export function DetourCalculator({ defaults }: { defaults: { detourPrice: string; consumption: string; volume: string } }) {
  const [volume, setVolume] = useState(defaults.volume);
  const [base, setBase] = useState("");
  const [detour, setDetour] = useState(defaults.detourPrice);
  const [extraKm, setExtraKm] = useState("");
  const [l100, setL100] = useState(defaults.consumption);
  const [tolls, setTolls] = useState("");
  const [minutes, setMinutes] = useState("");
  const [valueH, setValueH] = useState("");
  const r = useMemo(() => {
    const v = n(volume), b = n(base), d = n(detour), k = n(extraKm), c = n(l100);
    if (!v || !b || !d || k == null || !c) return null;
    return evaluateDetour({ plannedVolumeL: v, baselinePrice: b, detourPrice: d, extraKm: k, consumptionL100: c, fuelPriceForDetour: d, tolls: n(tolls), extraMinutes: n(minutes), valuePerHour: n(valueH) });
  }, [volume, base, detour, extraKm, l100, tolls, minutes, valueH]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Volume prévu (L)" htmlFor="d-v"><Input id="d-v" inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} /></Field>
        <Field label="Prix sur votre trajet (€/L)" htmlFor="d-b"><Input id="d-b" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} /></Field>
        <Field label="Prix de la station du détour (€/L)" htmlFor="d-d"><Input id="d-d" inputMode="decimal" value={detour} onChange={(e) => setDetour(e.target.value)} /></Field>
        <Field label="Km supplémentaires (aller + retour)" htmlFor="d-k" hint="Distance routière, pas à vol d'oiseau"><Input id="d-k" inputMode="decimal" value={extraKm} onChange={(e) => setExtraKm(e.target.value)} /></Field>
        <Field label="Consommation (L/100 km)" htmlFor="d-c"><Input id="d-c" inputMode="decimal" value={l100} onChange={(e) => setL100(e.target.value)} /></Field>
        <Field label="Péages (€)" htmlFor="d-t"><Input id="d-t" inputMode="decimal" value={tolls} onChange={(e) => setTolls(e.target.value)} /></Field>
        <Field label="Minutes en plus" htmlFor="d-m"><Input id="d-m" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
        <Field label="Valeur de votre temps (€/h)" htmlFor="d-h"><Input id="d-h" inputMode="decimal" value={valueH} onChange={(e) => setValueH(e.target.value)} /></Field>
      </div>
      {r ? (
        <div aria-live="polite" className={`rounded-2xl p-4 ${r.worthIt ? "bg-green-soft" : "bg-loss-soft"}`}>
          <p className="text-lg font-bold">{r.worthIt ? "Le détour est rentable" : "Le détour ne vaut pas le coup"} : {formatMoney(r.netGain)} net</p>
          <p className="num text-sm">Gain brut {formatMoney(r.grossGain)} − carburant du détour {formatMoney(r.detourFuelCost)} − autres coûts {formatMoney(r.otherCosts)}</p>
          {r.breakEvenVolumeL && <p className="text-sm">Rentable à partir de {formatLiters(r.breakEvenVolumeL)} achetés.</p>}
          <p className="mt-1 text-sm">{r.message}</p>
        </div>
      ) : (
        <Notice tone="info">Renseignez volume, deux prix, distance supplémentaire et consommation.</Notice>
      )}
    </div>
  );
}

export function TripPlanner({ defaults }: { defaults: { consumption: string; tank: string; price: string } }) {
  const [km, setKm] = useState("");
  const [l100, setL100] = useState(defaults.consumption);
  const [price, setPrice] = useState(defaults.price);
  const [tank, setTank] = useState(defaults.tank);
  const [tolls, setTolls] = useState("");
  const r = useMemo(() => {
    const d = n(km), c = n(l100), p = n(price);
    if (!d || !c || !p) return null;
    const liters = d.times(c).div(100);
    const t = n(tank);
    const stops = t && t.gt(0) ? Math.max(0, Math.ceil(liters.div(t.times(0.85)).toNumber()) - 1) : null;
    return { liters, cost: liters.times(p).plus(n(tolls) ?? 0), stops };
  }, [km, l100, price, tank, tolls]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Distance du voyage (km)" htmlFor="t-km" hint="Saisie manuelle (itinéraire à connecter)"><Input id="t-km" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
        <Field label="Consommation (L/100 km)" htmlFor="t-c"><Input id="t-c" inputMode="decimal" value={l100} onChange={(e) => setL100(e.target.value)} /></Field>
        <Field label="Prix moyen prévu (€/L)" htmlFor="t-p"><Input id="t-p" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Réservoir (L)" htmlFor="t-r"><Input id="t-r" inputMode="decimal" value={tank} onChange={(e) => setTank(e.target.value)} /></Field>
        <Field label="Péages (€)" htmlFor="t-t"><Input id="t-t" inputMode="decimal" value={tolls} onChange={(e) => setTolls(e.target.value)} /></Field>
      </div>
      {r && (
        <p aria-live="polite" className="num rounded-2xl bg-surface-2 p-4 text-sm">
          Estimation : <strong>{formatLiters(r.liters)}</strong>, <strong>{formatMoney(r.cost)}</strong>{r.stops != null ? `, environ ${r.stops} arrêt(s) carburant en partant plein (marge de 15 %)` : ""}.
        </p>
      )}
    </div>
  );
}
