import { D, Decimal, sum, ZERO } from "@/lib/decimal";

/**
 * §10 — Quatre valeurs distinctes par projet :
 *  - gains calculés, gains nets après conversion, montant affecté théoriquement, versements confirmés.
 * Aucun euro n'est affecté à deux projets : la répartition se fait au centime près (plus forts restes).
 */

export interface ProjectShare {
  projectId: string;
  /** Soit un pourcentage (0–100), soit un montant fixe par affectation. */
  percent?: Decimal | null;
  fixedAmount?: Decimal | null;
}

export interface AllocationLine {
  projectId: string;
  amount: Decimal;
}

/**
 * Répartit un montant entre projets. Les montants fixes sont servis d'abord, puis le reste
 * en pourcentages. La somme des lignes n'excède jamais le montant disponible.
 */
export function splitAllocation(available: Decimal, shares: ProjectShare[]): AllocationLine[] {
  if (available.lte(0) || shares.length === 0) return [];
  const cents = available.times(100).floor();
  let remaining = cents;
  const out = new Map<string, Decimal>();
  for (const s of shares.filter((x) => x.fixedAmount && x.fixedAmount.gt(0))) {
    const c = Decimal.min(remaining, s.fixedAmount!.times(100).floor());
    out.set(s.projectId, c);
    remaining = remaining.minus(c);
  }
  const pct = shares.filter((x) => !x.fixedAmount && x.percent && x.percent.gt(0));
  const totalPct = sum(pct.map((s) => s.percent!));
  if (pct.length > 0 && remaining.gt(0)) {
    // Si la somme des pourcentages < 100, le reste n'est pas affecté.
    const fullShare = totalPct.toDecimalPlaces(6).gte(100);
    const base = fullShare ? remaining : Decimal.min(remaining, remaining.times(totalPct).div(100).floor());
    const raw = pct.map((s) => ({ id: s.projectId, exact: base.times(s.percent!).div(totalPct) }));
    const floored = raw.map((r) => ({ ...r, c: r.exact.floor(), rest: r.exact.minus(r.exact.floor()) }));
    let leftover = base.minus(sum(floored.map((f) => f.c)));
    floored.sort((a, b) => b.rest.cmp(a.rest));
    for (const f of floored) {
      let c = f.c;
      if (leftover.gt(0)) {
        c = c.plus(1);
        leftover = leftover.minus(1);
      }
      out.set(f.id, (out.get(f.id) ?? ZERO).plus(c));
    }
  }
  return [...out.entries()].filter(([, c]) => c.gt(0)).map(([projectId, c]) => ({ projectId, amount: c.div(100) }));
}

export interface SavingsCapacityInput {
  /** Gains carburant cumulés calculés (mesurés, complets). */
  calculatedGains: Decimal;
  conversionCost: Decimal;
  /** Option : déduire la conversion avant affectation (défaut : oui). */
  deductConversion: boolean;
  /** Total déjà affecté aux projets. */
  alreadyAllocated: Decimal;
}

export interface SavingsCapacity {
  basis: Decimal;
  /** Capacité d'affectation restante, bornée à zéro. */
  capacity: Decimal;
  /** Montant négatif à rattraper avant toute nouvelle affectation (jamais repris sur l'épargne). */
  deficit: Decimal;
  message: string;
}

/**
 * Politique par défaut : affecter au maximum les gains nets positifs cumulés non encore affectés.
 * Une perte ultérieure réduit la capacité future mais ne retire jamais d'argent déjà épargné.
 */
export function savingsCapacity(i: SavingsCapacityInput): SavingsCapacity {
  const basis = i.deductConversion ? i.calculatedGains.minus(i.conversionCost) : i.calculatedGains;
  const raw = basis.minus(i.alreadyAllocated);
  if (raw.gte(0)) {
    return {
      basis,
      capacity: raw,
      deficit: ZERO,
      message: raw.gt(0) ? "Gains disponibles pour vos projets." : "Tous les gains disponibles sont déjà affectés.",
    };
  }
  return {
    basis,
    capacity: ZERO,
    deficit: raw.negated(),
    message:
      "Capacité réduite : des pertes récentes doivent être compensées avant de nouvelles affectations. L'argent déjà épargné n'est pas repris.",
  };
}

export interface ProjectFigures {
  allocated: Decimal;
  declaredManual: Decimal;
  bankConfirmed: Decimal;
  inFlight: Decimal;
}

/** Montant que l'on peut encore verser (manuel ou ordre) pour un projet sans double comptage. */
export function transferable(p: ProjectFigures): Decimal {
  return Decimal.max(ZERO, p.allocated.minus(p.declaredManual).minus(p.bankConfirmed).minus(p.inFlight));
}

export function progressRatio(saved: Decimal, target: Decimal | null): Decimal | null {
  if (!target || target.lte(0)) return null;
  return Decimal.min(D(1), saved.div(target));
}
