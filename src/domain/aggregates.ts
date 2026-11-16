import { Decimal, sum, ZERO } from "@/lib/decimal";
import type { ConsumptionInterval } from "./consumption";
import type { ComparisonResult } from "./comparison";

/** Clé de mois locale (YYYY-MM) dans le fuseau de l'utilisateur. */
export function monthKey(d: Date, timeZone = "Europe/Paris"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

export interface MonthlyRow {
  month: string;
  /** Trésorerie : dépenses par date d'achat. */
  spend: Decimal;
  liters: Decimal;
  /** Mesures attribuées à la date de fermeture d'intervalle. */
  measuredDistanceKm: Decimal;
  measuredVolumeL: Decimal;
  consumptionL100: Decimal | null;
  /** Gains mesurés et complets uniquement. */
  measuredGain: Decimal | null;
  incompleteComparisons: number;
}

export function monthlyAggregates(
  purchases: { occurredAt: Date; total: Decimal; liters: Decimal }[],
  intervals: ConsumptionInterval[],
  comparisons: ComparisonResult[],
  timeZone = "Europe/Paris",
): MonthlyRow[] {
  const rows = new Map<string, MonthlyRow>();
  const row = (m: string) => {
    let r = rows.get(m);
    if (!r) {
      r = { month: m, spend: ZERO, liters: ZERO, measuredDistanceKm: ZERO, measuredVolumeL: ZERO, consumptionL100: null, measuredGain: null, incompleteComparisons: 0 };
      rows.set(m, r);
    }
    return r;
  };
  for (const p of purchases) {
    const r = row(monthKey(p.occurredAt, timeZone));
    r.spend = r.spend.plus(p.total);
    r.liters = r.liters.plus(p.liters);
  }
  const cmp = new Map(comparisons.map((c) => [c.intervalEndFillupId, c]));
  for (const it of intervals) {
    if (it.status !== "measured") continue;
    const r = row(monthKey(it.closedAt, timeZone));
    r.measuredDistanceKm = r.measuredDistanceKm.plus(it.distanceKm);
    r.measuredVolumeL = r.measuredVolumeL.plus(it.volumeL);
    const c = cmp.get(it.endFillupId);
    if (c?.status === "complete" && c.gain) r.measuredGain = (r.measuredGain ?? ZERO).plus(c.gain);
    else r.incompleteComparisons++;
  }
  for (const r of rows.values())
    r.consumptionL100 = r.measuredDistanceKm.gt(0) ? r.measuredVolumeL.times(100).div(r.measuredDistanceKm) : null;
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Ventilation proratisée d'un intervalle sur les mois qu'il couvre — estimation documentée
 * (au prorata du temps), jamais présentée comme mesure mensuelle.
 */
export function prorateByMonth(start: Date, end: Date, value: Decimal, timeZone = "Europe/Paris"): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  const total = end.getTime() - start.getTime();
  if (total <= 0) {
    out.set(monthKey(end, timeZone), value);
    return out;
  }
  let cursor = start.getTime();
  const dayMs = 86_400_000;
  while (cursor < end.getTime()) {
    const next = Math.min(cursor + dayMs, end.getTime());
    const k = monthKey(new Date(cursor), timeZone);
    out.set(k, (out.get(k) ?? ZERO).plus(value.times(next - cursor).div(total)));
    cursor = next;
  }
  return out;
}

export function totals(values: Decimal[]): Decimal {
  return sum(values);
}
