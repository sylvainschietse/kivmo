import { Decimal, ZERO } from "@/lib/decimal";

/**
 * §7.2 — Estimation avant historique réel. Toujours libellée « estimation ».
 */
export interface E85EstimateInput {
  gasolineL100: Decimal;
  gasolinePrice: Decimal;
  /** Hypothèse de surconsommation, ex. 0.25 pour +25 %. */
  overconsumption: Decimal;
  e85Price: Decimal;
  conversionCost: Decimal;
  /** Facultatif : consommation E85 saisie directement (prioritaire sur l'hypothèse). */
  e85L100?: Decimal | null;
  annualKm?: Decimal | null;
}

export interface E85Estimate {
  kind: "estimation";
  e85L100: Decimal;
  gasolineCostPer100: Decimal;
  e85CostPer100: Decimal;
  gainPer100: Decimal;
  gainPerKm: Decimal;
  /** Prix E85 en dessous duquel l'E85 est moins cher au km. */
  e85BreakEvenPrice: Decimal;
  /** null si gain/km ≤ 0 : « pas d'amortissement prévu avec ces hypothèses ». */
  amortizationKm: Decimal | null;
  amortizationMonths: Decimal | null;
  message: string;
}

export function estimateE85(input: E85EstimateInput): E85Estimate {
  const e85L100 = input.e85L100 ?? input.gasolineL100.times(input.overconsumption.plus(1));
  const gasolineCost = input.gasolineL100.times(input.gasolinePrice);
  const e85Cost = e85L100.times(input.e85Price);
  const gainPer100 = gasolineCost.minus(e85Cost);
  const gainPerKm = gainPer100.div(100);
  const breakEven = input.gasolineL100.times(input.gasolinePrice).div(e85L100);
  let amortizationKm: Decimal | null = null;
  let months: Decimal | null = null;
  let message: string;
  if (gainPerKm.gt(0)) {
    amortizationKm = input.conversionCost.div(gainPerKm);
    if (input.annualKm && input.annualKm.gt(0)) months = amortizationKm.div(input.annualKm).times(12);
    message = "Estimation : amortissement prévisionnel calculé avec ces hypothèses.";
  } else {
    message = "Estimation : pas d'amortissement prévu avec ces hypothèses.";
  }
  return {
    kind: "estimation",
    e85L100,
    gasolineCostPer100: gasolineCost,
    e85CostPer100: e85Cost,
    gainPer100,
    gainPerKm,
    e85BreakEvenPrice: breakEven,
    amortizationKm,
    amortizationMonths: months,
    message,
  };
}

/**
 * §8 — Détour vers une station moins chère.
 * Gain brut = volume × différence de prix ; coût détour = km supplémentaires × conso / 100 × prix du carburant utilisé.
 */
export interface DetourInput {
  plannedVolumeL: Decimal;
  /** Prix de la station sur l'itinéraire initial. */
  baselinePrice: Decimal;
  /** Prix de la station du détour. */
  detourPrice: Decimal;
  /** Distance SUPPLÉMENTAIRE par rapport à l'itinéraire initial, retour/reprise compris. */
  extraKm: Decimal;
  consumptionL100: Decimal;
  /** Prix du carburant consommé pendant le détour. */
  fuelPriceForDetour: Decimal;
  tolls?: Decimal | null;
  extraMinutes?: Decimal | null;
  valuePerHour?: Decimal | null;
}

export interface DetourResult {
  priceDifference: Decimal;
  grossGain: Decimal;
  detourFuelCost: Decimal;
  otherCosts: Decimal;
  netGain: Decimal;
  /** Volume à partir duquel le détour devient rentable ; null si aucune différence de prix favorable. */
  breakEvenVolumeL: Decimal | null;
  worthIt: boolean;
  message: string;
}

export function evaluateDetour(input: DetourInput): DetourResult {
  const diff = input.baselinePrice.minus(input.detourPrice);
  const gross = input.plannedVolumeL.times(diff);
  const fuelCost = input.extraKm.times(input.consumptionL100).div(100).times(input.fuelPriceForDetour);
  const timeCost =
    input.extraMinutes && input.valuePerHour ? input.extraMinutes.div(60).times(input.valuePerHour) : ZERO;
  const other = (input.tolls ?? ZERO).plus(timeCost);
  const detourTotal = fuelCost.plus(other);
  const net = gross.minus(detourTotal);
  if (diff.lte(0)) {
    return {
      priceDifference: diff,
      grossGain: gross,
      detourFuelCost: fuelCost,
      otherCosts: other,
      netGain: net,
      breakEvenVolumeL: null,
      worthIt: false,
      message: "Aucun intérêt lié au prix : la station du détour n'est pas moins chère.",
    };
  }
  return {
    priceDifference: diff,
    grossGain: gross,
    detourFuelCost: fuelCost,
    otherCosts: other,
    netGain: net,
    breakEvenVolumeL: detourTotal.div(diff),
    worthIt: net.gt(0),
    message: net.gt(0) ? "Détour rentable avec ces hypothèses." : "Détour non rentable avec ces hypothèses.",
  };
}

/** Distance à vol d'oiseau (haversine) — toujours libellée comme telle, jamais présentée comme routière. */
export function crowFliesKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371.0088;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
