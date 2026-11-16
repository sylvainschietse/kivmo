import { D, Decimal } from "@/lib/decimal";

/**
 * §6 — Deux valeurs parmi litres / prix unitaire / total calculent la troisième.
 * Si les trois sont saisies et divergent au-delà de la tolérance, on demande laquelle corriger.
 * La remise éventuelle est conservée séparément : total facturé = litres × prix affiché − remise.
 */
export type AmountField = "liters" | "unitPrice" | "total";

export interface AmountEntry {
  liters?: Decimal | null;
  unitPrice?: Decimal | null;
  total?: Decimal | null;
  discount?: Decimal | null;
}

export type AmountResolution =
  | { ok: true; liters: Decimal; unitPrice: Decimal; total: Decimal; discount: Decimal; computed: AmountField | null }
  | { ok: false; error: "MISSING_VALUES"; message: string }
  | {
      ok: false;
      error: "MISMATCH";
      message: string;
      expectedTotal: Decimal;
      candidates: Record<AmountField, Decimal>;
    };

export const AMOUNT_TOLERANCE_EUR = D("0.05");

export function resolveAmounts(e: AmountEntry, tolerance = AMOUNT_TOLERANCE_EUR): AmountResolution {
  const discount = e.discount ?? D(0);
  const { liters, unitPrice, total } = e;
  const present = [liters, unitPrice, total].filter((v) => v !== null && v !== undefined).length;
  if (present < 2) {
    return { ok: false, error: "MISSING_VALUES", message: "Saisissez au moins deux valeurs parmi litres, prix au litre et total." };
  }
  if (liters && liters.lte(0)) return { ok: false, error: "MISSING_VALUES", message: "Les litres doivent être positifs." };
  if (present === 2) {
    if (!total) {
      return { ok: true, liters: liters!, unitPrice: unitPrice!, total: liters!.times(unitPrice!).minus(discount), discount, computed: "total" };
    }
    if (!liters) {
      if (unitPrice!.lte(0)) return { ok: false, error: "MISSING_VALUES", message: "Le prix au litre doit être positif." };
      return { ok: true, liters: total.plus(discount).div(unitPrice!), unitPrice: unitPrice!, total, discount, computed: "liters" };
    }
    return { ok: true, liters, unitPrice: total.plus(discount).div(liters), total, discount, computed: "unitPrice" };
  }
  const expected = liters!.times(unitPrice!).minus(discount);
  if (expected.minus(total!).abs().lte(tolerance)) {
    return { ok: true, liters: liters!, unitPrice: unitPrice!, total: total!, discount, computed: null };
  }
  return {
    ok: false,
    error: "MISMATCH",
    message:
      "Les litres, le prix au litre et le total ne concordent pas. Quelle valeur voulez-vous corriger ? Le ticket fait foi pour le montant payé.",
    expectedTotal: expected,
    candidates: {
      total: expected,
      liters: total!.plus(discount).div(unitPrice!),
      unitPrice: total!.plus(discount).div(liters!),
    },
  };
}

export interface FillupValidationInput {
  occurredAt: Date;
  odometerKm: Decimal;
  liters: Decimal;
  tankCapacityL?: Decimal | null;
  previous?: { occurredAt: Date; odometerKm: Decimal } | null;
  next?: { occurredAt: Date; odometerKm: Decimal } | null;
  now?: Date;
}

export interface ValidationIssue {
  code: "PROBABLE_DUPLICATE" | "FUTURE_DATE" | "LITERS_NOT_POSITIVE" | "ODOMETER_NOT_INCREASING" | "ODOMETER_ABOVE_NEXT" | "ABOVE_TANK";
  message: string;
  /** blocking : à corriger ; confirmable : l'utilisateur peut confirmer avec une explication. */
  level: "blocking" | "confirmable";
}

/** §6 — Les cas exceptionnels passent par une correction explicitée, pas par un blocage sans recours. */
export function validateFillup(v: FillupValidationInput): ValidationIssue[] {
  const now = v.now ?? new Date();
  const issues: ValidationIssue[] = [];
  if (v.occurredAt.getTime() > now.getTime() + 5 * 60_000)
    issues.push({ code: "FUTURE_DATE", message: "La date du plein est dans le futur.", level: "blocking" });
  if (v.liters.lte(0))
    issues.push({ code: "LITERS_NOT_POSITIVE", message: "Le volume doit être strictement positif.", level: "blocking" });
  if (v.previous && v.odometerKm.lte(v.previous.odometerKm))
    issues.push({
      code: "ODOMETER_NOT_INCREASING",
      message: `Le compteur devrait dépasser ${v.previous.odometerKm.toFixed(0)} km (plein précédent). Compteur remplacé ? Déclarez-le dans le garage, ou confirmez avec une explication.`,
      level: "confirmable",
    });
  if (v.next && v.odometerKm.gte(v.next.odometerKm))
    issues.push({
      code: "ODOMETER_ABOVE_NEXT",
      message: `Le compteur dépasse celui d'un plein postérieur (${v.next.odometerKm.toFixed(0)} km).`,
      level: "confirmable",
    });
  if (v.tankCapacityL && v.liters.gt(v.tankCapacityL.times(1.05)))
    issues.push({
      code: "ABOVE_TANK",
      message: `Le volume dépasse la capacité déclarée du réservoir (${v.tankCapacityL.toFixed(0)} L).`,
      level: "confirmable",
    });
  return issues;
}

/** Doublon probable : même véhicule, même montant, moins de 30 min d'écart. L'utilisateur peut confirmer. */
export function isProbableDuplicate(
  a: { occurredAt: Date; total: Decimal; odometerKm: Decimal },
  b: { occurredAt: Date; total: Decimal; odometerKm: Decimal },
): boolean {
  const close = Math.abs(a.occurredAt.getTime() - b.occurredAt.getTime()) < 30 * 60_000;
  return close && a.total.minus(b.total).abs().lte("0.01") && a.odometerKm.minus(b.odometerKm).abs().lte(5);
}
