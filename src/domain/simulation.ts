import { D, Decimal, ZERO } from "@/lib/decimal";

/**
 * §9 — Simulation essence / diesel / E85 / GPL / hybride / électrique.
 * Les litres et les kWh ne sont jamais mélangés dans un même indicateur : seul le coût
 * kilométrique (€/km) sert de base commune.
 */
export type Energy = "essence" | "diesel" | "e85" | "gpl" | "hybride_rechargeable" | "electrique";

export const ENERGY_LABELS: Record<Energy, string> = {
  essence: "Essence",
  diesel: "Diesel",
  e85: "E85",
  gpl: "GPL",
  hybride_rechargeable: "Hybride rechargeable",
  electrique: "Électrique",
};

export interface ThermalUsage {
  l100: Decimal;
  pricePerL: Decimal;
}

export interface ElectricUsage {
  /** Énergie consommée par le véhicule (kWh/100 km). */
  kwh100Vehicle: Decimal;
  /** Pertes de charge (0.10 = 10 %) : kWh facturés = kWh véhicule × (1 + pertes). */
  chargingLosses: Decimal;
  /** Prix du kWh facturé. Une charge gratuite = 0. */
  pricePerKwh: Decimal;
  /** Montant réellement facturé par session si tarif à la minute ou forfait (optionnel, prioritaire). */
  billedPer100Override?: Decimal | null;
}

export interface SimulationScenario {
  id: string;
  label: string;
  energy: Energy;
  annualKm: Decimal;
  years: Decimal;
  thermal?: ThermalUsage | null;
  electric?: ElectricUsage | null;
  /** Hybride rechargeable : part des km en électrique (0–1), le reste en thermique. */
  electricShare?: Decimal | null;
  purchasePrice?: Decimal | null;
  resaleValue?: Decimal | null;
  conversionCost?: Decimal | null;
  maintenancePerYear?: Decimal | null;
  insurancePerYear?: Decimal | null;
  financingTotalCost?: Decimal | null;
  chargerInstallCost?: Decimal | null;
}

export interface SimulationResult {
  id: string;
  label: string;
  energy: Energy;
  totalKm: Decimal;
  litersPerYear: Decimal | null;
  kwhBilledPerYear: Decimal | null;
  energyCostPerYear: Decimal;
  fixedCosts: Decimal;
  totalCost: Decimal;
  costPerKm: Decimal;
  energyCostPerKm: Decimal;
  warnings: string[];
}

export function simulate(s: SimulationScenario): SimulationResult {
  const warnings: string[] = [];
  const totalKm = s.annualKm.times(s.years);
  let thermalShare = D(1);
  let electricShare = ZERO;
  if (s.energy === "electrique") {
    thermalShare = ZERO;
    electricShare = D(1);
  } else if (s.energy === "hybride_rechargeable") {
    electricShare = Decimal.min(D(1), Decimal.max(ZERO, s.electricShare ?? ZERO));
    thermalShare = D(1).minus(electricShare);
    if (!s.electricShare) warnings.push("Part de kilomètres électriques non renseignée : 0 % retenu.");
  }

  let liters: Decimal | null = null;
  let thermalCost = ZERO;
  if (thermalShare.gt(0)) {
    if (!s.thermal) warnings.push("Consommation thermique manquante.");
    else {
      liters = s.annualKm.times(thermalShare).times(s.thermal.l100).div(100);
      thermalCost = liters.times(s.thermal.pricePerL);
    }
  }
  let kwh: Decimal | null = null;
  let elecCost = ZERO;
  if (electricShare.gt(0)) {
    if (!s.electric) warnings.push("Consommation électrique manquante.");
    else {
      const km = s.annualKm.times(electricShare);
      kwh = km.times(s.electric.kwh100Vehicle).div(100).times(s.electric.chargingLosses.plus(1));
      elecCost = s.electric.billedPer100Override ? km.div(100).times(s.electric.billedPer100Override) : kwh.times(s.electric.pricePerKwh);
    }
  }
  const energyPerYear = thermalCost.plus(elecCost);
  const fixed = (s.purchasePrice ?? ZERO)
    .minus(s.resaleValue ?? ZERO)
    .plus(s.conversionCost ?? ZERO)
    .plus(s.chargerInstallCost ?? ZERO)
    .plus(s.financingTotalCost ?? ZERO)
    .plus((s.maintenancePerYear ?? ZERO).plus(s.insurancePerYear ?? ZERO).times(s.years));
  const total = energyPerYear.times(s.years).plus(fixed);
  return {
    id: s.id,
    label: s.label,
    energy: s.energy,
    totalKm,
    litersPerYear: liters,
    kwhBilledPerYear: kwh,
    energyCostPerYear: energyPerYear,
    fixedCosts: fixed,
    totalCost: total,
    costPerKm: totalKm.gt(0) ? total.div(totalKm) : ZERO,
    energyCostPerKm: s.annualKm.gt(0) ? energyPerYear.div(s.annualKm) : ZERO,
    warnings,
  };
}
