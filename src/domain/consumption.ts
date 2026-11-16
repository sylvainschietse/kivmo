import { D, Decimal, sum, ZERO } from "@/lib/decimal";
import type { FillupInput, FuelCode } from "./types";

/** Version du moteur : stockée avec chaque résultat pour des recalculs reproductibles. */
export const CALC_VERSION = "2026.11-1";

export type IntervalStatus = "measured" | "suspect" | "invalid";

export type IntervalIssue =
  | "DISTANCE_NOT_POSITIVE"
  | "MISSED_FILLUP_DECLARED"
  | "VOLUME_ABOVE_TANK"
  | "IMPLAUSIBLE_CONSUMPTION";

export const ISSUE_MESSAGES: Record<IntervalIssue, string> = {
  DISTANCE_NOT_POSITIVE:
    "Compteur identique ou inférieur au repère : aucune consommation ne peut être mesurée sur cet intervalle.",
  MISSED_FILLUP_DECLARED:
    "Un plein oublié a été signalé : reconstituez l'achat manquant ou repartez d'un nouveau repère complet.",
  VOLUME_ABOVE_TANK: "Un achat dépasse la capacité déclarée du réservoir : vérifiez les litres saisis.",
  IMPLAUSIBLE_CONSUMPTION:
    "Consommation hors des valeurs plausibles : un achat est probablement manquant ou mal saisi.",
};

export interface ConsumptionInterval {
  startFillupId: string;
  endFillupId: string;
  /** Achats inclus : tous les achats après A jusqu'à B inclus (A exclu). */
  includedFillupIds: string[];
  startOdometerKm: Decimal;
  endOdometerKm: Decimal;
  distanceKm: Decimal;
  volumeL: Decimal;
  cost: Decimal;
  consumptionL100: Decimal | null;
  costPer100: Decimal | null;
  litersByFuel: Partial<Record<FuelCode, Decimal>>;
  status: IntervalStatus;
  issues: IntervalIssue[];
  /** Les mesures d'intervalle sont attribuées par défaut à la date de fermeture. */
  closedAt: Date;
  calcVersion: string;
}

export interface ConsumptionAnalysis {
  baselineFillupId: string | null;
  intervals: ConsumptionInterval[];
  /** Achats avant tout repère complet : dépense comptée, aucune consommation mesurée. */
  unmeasuredFillupIds: string[];
  /** Achats partiels en attente du prochain plein complet. */
  pendingFillupIds: string[];
  /** Incohérences chronologiques du compteur (ordre des dates vs compteur). */
  chronologyWarnings: { fillupId: string; message: string }[];
}

export interface ConsumptionOptions {
  tankCapacityL?: Decimal | null;
  /** Bornes de plausibilité (L/100 km) pour signaler, jamais pour bloquer. */
  plausibleMinL100?: Decimal;
  plausibleMaxL100?: Decimal;
}

const fillupLiters = (f: FillupInput) => sum(f.lines.map((l) => l.liters));
const fillupCost = (f: FillupInput) => sum(f.lines.map((l) => l.amountPaid));

export function sortFillups(fillups: FillupInput[]): FillupInput[] {
  return [...fillups].sort((a, b) => {
    const t = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (t !== 0) return t;
    return a.odometerKm.cmp(b.odometerKm);
  });
}

/**
 * Mesure plein à plein (§7.1).
 * D = compteur(B) − compteur(A) ; V = Σ litres après A jusqu'à B inclus ; C = Σ montants.
 * Consommation = 100 × V / D ; coût aux 100 km = 100 × C / D. D doit être > 0.
 */
export function analyzeConsumption(fillups: FillupInput[], opts: ConsumptionOptions = {}): ConsumptionAnalysis {
  const minL100 = opts.plausibleMinL100 ?? D(2);
  const maxL100 = opts.plausibleMaxL100 ?? D(30);
  const sorted = sortFillups(fillups);

  const chronologyWarnings: ConsumptionAnalysis["chronologyWarnings"] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].odometerKm.lt(sorted[i - 1].odometerKm)) {
      chronologyWarnings.push({
        fillupId: sorted[i].id,
        message: "Le compteur est inférieur à celui d'un achat antérieur : corrigez la date ou le compteur.",
      });
    }
  }

  const intervals: ConsumptionInterval[] = [];
  const unmeasured: string[] = [];
  let baseline: FillupInput | null = null;
  let firstBaselineId: string | null = null;
  let pending: FillupInput[] = [];

  for (const f of sorted) {
    if (!baseline) {
      if (f.isFull) {
        baseline = f;
        firstBaselineId ??= f.id;
      } else {
        unmeasured.push(f.id);
      }
      continue;
    }
    if (f.isFull && f.startsNewBaseline) {
      // Séquence abandonnée : les achats en attente ne sont pas mesurés.
      unmeasured.push(...pending.map((p) => p.id));
      pending = [];
      baseline = f;
      continue;
    }
    pending.push(f);
    if (!f.isFull) continue;

    const included = pending;
    const distance = f.odometerKm.minus(baseline.odometerKm);
    const volume = sum(included.map(fillupLiters));
    const cost = sum(included.map(fillupCost));
    const litersByFuel: Partial<Record<FuelCode, Decimal>> = {};
    for (const p of included)
      for (const l of p.lines) litersByFuel[l.fuel] = (litersByFuel[l.fuel] ?? ZERO).plus(l.liters);

    const issues: IntervalIssue[] = [];
    let consumption: Decimal | null = null;
    let costPer100: Decimal | null = null;
    if (distance.lte(0)) {
      issues.push("DISTANCE_NOT_POSITIVE");
    } else {
      consumption = volume.times(100).div(distance);
      costPer100 = cost.times(100).div(distance);
      if (consumption.lt(minL100) || consumption.gt(maxL100)) issues.push("IMPLAUSIBLE_CONSUMPTION");
    }
    if (included.some((p) => p.missedBefore)) issues.push("MISSED_FILLUP_DECLARED");
    if (opts.tankCapacityL && included.some((p) => fillupLiters(p).gt(opts.tankCapacityL!.times(1.05))))
      issues.push("VOLUME_ABOVE_TANK");

    const status: IntervalStatus = issues.includes("DISTANCE_NOT_POSITIVE")
      ? "invalid"
      : issues.length > 0
        ? "suspect"
        : "measured";

    intervals.push({
      startFillupId: baseline.id,
      endFillupId: f.id,
      includedFillupIds: included.map((p) => p.id),
      startOdometerKm: baseline.odometerKm,
      endOdometerKm: f.odometerKm,
      distanceKm: distance,
      volumeL: volume,
      cost,
      consumptionL100: status === "invalid" ? null : consumption,
      costPer100: status === "invalid" ? null : costPer100,
      litersByFuel,
      status,
      issues,
      closedAt: f.occurredAt,
      calcVersion: CALC_VERSION,
    });
    baseline = f;
    pending = [];
  }

  return {
    baselineFillupId: firstBaselineId,
    intervals,
    unmeasuredFillupIds: unmeasured,
    pendingFillupIds: pending.map((p) => p.id),
    chronologyWarnings,
  };
}

/** Moyenne pondérée : volume total / distance totale (jamais la moyenne simple des ratios). */
export function averageConsumption(intervals: ConsumptionInterval[]): Decimal | null {
  const ok = intervals.filter((i) => i.status === "measured");
  const distance = sum(ok.map((i) => i.distanceKm));
  if (distance.lte(0)) return null;
  return sum(ok.map((i) => i.volumeL)).times(100).div(distance);
}

export function averageCostPer100(intervals: ConsumptionInterval[]): Decimal | null {
  const ok = intervals.filter((i) => i.status === "measured");
  const distance = sum(ok.map((i) => i.distanceKm));
  if (distance.lte(0)) return null;
  return sum(ok.map((i) => i.cost)).times(100).div(distance);
}

/** Message d'état pour l'accueil (§4, cas E et M). */
export function consumptionHeadline(a: ConsumptionAnalysis): string {
  if (!a.baselineFillupId) return "Données insuffisantes pour mesurer la consommation : enregistrez un plein complet.";
  if (a.intervals.length === 0) return "Premier plein : point de départ enregistré. En attente du prochain plein complet.";
  const last = a.intervals[a.intervals.length - 1];
  if (last.status !== "measured") return ISSUE_MESSAGES[last.issues[0]];
  if (a.pendingFillupIds.length > 0) return "Consommation mesurée sur le dernier intervalle ; en attente du prochain plein complet.";
  return "Consommation mesurée entre deux pleins complets.";
}

export { fillupLiters, fillupCost };
