import Decimal from "decimal.js";

/**
 * Tous les montants, volumes et prix passent par Decimal (jamais de flottant binaire
 * pour les calculs). Les arrondis ne se font qu'à l'affichage.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Dec = Decimal;
export type DecInput = Decimal | string | number;

export const D = (v: DecInput): Decimal => new Decimal(v);
export const ZERO = new Decimal(0);

export function sum(values: DecInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

/**
 * Lit une saisie utilisateur au format français ou international :
 * "1 234,56", "1234.56", "0,9" … Retourne null si la saisie n'est pas un nombre.
 */
export function parseDecimalFr(input: string | null | undefined): Decimal | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/[\s  ]/g, "").replace(/€|L|km/gi, "");
  if (s === "") return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // le dernier séparateur est le séparateur décimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s);
}

/** Valeur de stockage (chaîne) avec la précision de la colonne. */
export function toDb(v: Decimal, decimals: number): string {
  return v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals);
}
