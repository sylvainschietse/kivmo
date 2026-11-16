import { D, Decimal, sum, ZERO } from "@/lib/decimal";
import { fillupLiters, type ConsumptionInterval } from "./consumption";
import type { FillupInput, FuelCode } from "./types";

export interface ReferenceProfileInput {
  id: string;
  version: number;
  /** Date d'effet : le profil s'applique aux intervalles fermés à partir de cette date. */
  effectiveFrom: Date;
  consumptionL100: Decimal;
  fuel: FuelCode;
  /** fixed : prix de scénario fixe ; observed : prix moyen pondéré des instantanés. */
  priceMode: "fixed" | "observed";
  fixedPrice?: Decimal | null;
  label?: string;
  confidence?: "faible" | "moyenne" | "elevee";
}

export type ComparisonStatus = "complete" | "incomplete";

export interface ComparisonResult {
  intervalEndFillupId: string;
  status: ComparisonStatus;
  /** Raison lisible si incomplet : jamais de gain à zéro inventé. */
  missingReason: string | null;
  profileId: string | null;
  profileVersion: number | null;
  referencePrice: Decimal | null;
  priceMethod: string | null;
  referenceCost: Decimal | null;
  actualCost: Decimal;
  gain: Decimal | null;
  /** measured : intervalle mesuré ; estimated : issu d'une estimation acceptée. */
  basis: "measured" | "estimated";
}

export function profileAt(profiles: ReferenceProfileInput[], at: Date): ReferenceProfileInput | null {
  const eligible = profiles
    .filter((p) => p.effectiveFrom.getTime() <= at.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.version - a.version);
  return eligible[0] ?? null;
}

/**
 * §7.2 — Coût référence = D × conso référence / 100 × prix référence ; gain = coût référence − C.
 * Prix « observed » : moyenne des prix de référence instantanés pondérée par les litres achetés
 * dans l'intervalle. Un instantané manquant rend la comparaison incomplète.
 */
export function compareInterval(
  interval: ConsumptionInterval,
  fillupsById: Map<string, FillupInput>,
  profiles: ReferenceProfileInput[],
): ComparisonResult {
  const base: ComparisonResult = {
    intervalEndFillupId: interval.endFillupId,
    status: "incomplete",
    missingReason: null,
    profileId: null,
    profileVersion: null,
    referencePrice: null,
    priceMethod: null,
    referenceCost: null,
    actualCost: interval.cost,
    gain: null,
    basis: "measured",
  };
  if (interval.status !== "measured") {
    return { ...base, missingReason: "Intervalle non mesurable ou suspect : comparaison non calculée." };
  }
  const profile = profileAt(profiles, interval.closedAt);
  if (!profile) return { ...base, missingReason: "Aucune référence de comparaison active à cette date." };

  let refPrice: Decimal | null = null;
  let method: string;
  if (profile.priceMode === "fixed") {
    if (!profile.fixedPrice) return { ...base, profileId: profile.id, missingReason: "Prix de scénario non renseigné." };
    refPrice = profile.fixedPrice;
    method = "Prix fixe de scénario";
  } else {
    const included = interval.includedFillupIds.map((id) => fillupsById.get(id)!);
    const missing = included.filter((f) => !f.referencePrice || f.referencePrice.fuel !== profile.fuel);
    if (missing.length > 0) {
      return {
        ...base,
        profileId: profile.id,
        profileVersion: profile.version,
        missingReason: "Comparaison incomplète : prix de référence manquant pour au moins un achat de l'intervalle.",
      };
    }
    const liters = sum(included.map(fillupLiters));
    const weighted = sum(included.map((f) => f.referencePrice!.price.times(fillupLiters(f))));
    refPrice = weighted.div(liters);
    method = "Prix de référence moyen pondéré par les litres achetés dans l'intervalle";
  }

  const referenceCost = interval.distanceKm.times(profile.consumptionL100).div(100).times(refPrice);
  return {
    ...base,
    status: "complete",
    profileId: profile.id,
    profileVersion: profile.version,
    referencePrice: refPrice,
    priceMethod: method,
    referenceCost,
    gain: referenceCost.minus(interval.cost),
  };
}

export interface ConversionInput {
  cost: Decimal;
  date: Date;
  odometerKm: Decimal;
}

export interface AmortizationResult {
  conversionCost: Decimal;
  /** Somme des gains carburant éligibles (mesurés et complets) depuis la conversion — négatifs conservés. */
  cumulativeGain: Decimal;
  /** Gain net après conversion = gains cumulés − coût conversion (peut être négatif). */
  netAfterConversion: Decimal;
  /** Solde à amortir = max(0, coût − gains cumulés) : indicateur explicitement borné. */
  remainingToAmortize: Decimal;
  /** Date de la première fermeture d'intervalle où la conversion a été amortie. */
  initialAmortizedAt: Date | null;
  currentlyAmortized: boolean;
  /** Intervalles à cheval sur la conversion : nouveau repère ou estimation signalée nécessaire. */
  straddlingIntervalIds: string[];
  eligibleIntervalIds: string[];
  incompleteCount: number;
}

export function computeAmortization(
  intervals: ConsumptionInterval[],
  comparisons: ComparisonResult[],
  conversion: ConversionInput | null,
): AmortizationResult {
  const cost = conversion?.cost ?? ZERO;
  const byEnd = new Map(comparisons.map((c) => [c.intervalEndFillupId, c]));
  const straddling: string[] = [];
  const eligible: string[] = [];
  let cumulative = ZERO;
  let initialAmortizedAt: Date | null = null;
  let incomplete = 0;

  const ordered = [...intervals].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  for (const it of ordered) {
    if (conversion && it.startOdometerKm.lt(conversion.odometerKm)) {
      if (it.endOdometerKm.gt(conversion.odometerKm)) straddling.push(it.endFillupId);
      continue;
    }
    const cmp = byEnd.get(it.endFillupId);
    if (!cmp || cmp.status !== "complete" || !cmp.gain) {
      incomplete++;
      continue;
    }
    eligible.push(it.endFillupId);
    cumulative = cumulative.plus(cmp.gain);
    if (conversion && !initialAmortizedAt && cumulative.gte(cost)) initialAmortizedAt = it.closedAt;
  }
  const net = cumulative.minus(cost);
  return {
    conversionCost: cost,
    cumulativeGain: cumulative,
    netAfterConversion: net,
    remainingToAmortize: Decimal.max(ZERO, cost.minus(cumulative)),
    initialAmortizedAt,
    currentlyAmortized: net.gte(0),
    straddlingIntervalIds: straddling,
    eligibleIntervalIds: eligible,
    incompleteCount: incomplete,
  };
}

export { D };
