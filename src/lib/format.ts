import { Decimal, type DecInput } from "./decimal";

const nbsp = " ";

function frNumber(v: Decimal, decimals: number): string {
  const fixed = v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const negative = int.startsWith("-");
  const digits = negative ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (negative ? "−" : "") + grouped + (frac ? "," + frac : "");
}

/** Montant monétaire arrondi à deux décimales pour l'affichage uniquement. */
export function formatMoney(v: DecInput | null | undefined, currency = "EUR"): string {
  if (v === null || v === undefined) return "—";
  const symbol = currency === "EUR" ? "€" : currency;
  return frNumber(new Decimal(v), 2) + nbsp + symbol;
}

export function formatSignedMoney(v: DecInput, currency = "EUR"): string {
  const d = new Decimal(v);
  return (d.gt(0) ? "+" : "") + formatMoney(d, currency);
}

export function formatNumber(v: DecInput | null | undefined, decimals = 2): string {
  if (v === null || v === undefined) return "—";
  return frNumber(new Decimal(v), decimals);
}

export function formatLiters(v: DecInput | null | undefined): string {
  return v === null || v === undefined ? "—" : formatNumber(v, 2) + nbsp + "L";
}

export function formatKm(v: DecInput | null | undefined): string {
  return v === null || v === undefined ? "—" : formatNumber(v, 0) + nbsp + "km";
}

export function formatConsumption(v: DecInput | null | undefined): string {
  return v === null || v === undefined ? "—" : formatNumber(v, 2) + nbsp + "L/100" + nbsp + "km";
}

export function formatUnitPrice(v: DecInput | null | undefined, currency = "EUR"): string {
  if (v === null || v === undefined) return "—";
  return formatNumber(v, 3) + nbsp + (currency === "EUR" ? "€" : currency) + "/L";
}

export function formatDate(d: Date | string, timeZone = "Europe/Paris"): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone }).format(new Date(d));
}

export function formatDateTime(d: Date | string, timeZone = "Europe/Paris"): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(d));
}

/** « il y a 3 h », « il y a 2 j » — pour la fraîcheur des prix. */
export function formatAge(d: Date | string, now = new Date()): string {
  const ms = now.getTime() - new Date(d).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/**
 * Kilométrage lu sur une photo : garde les kilomètres entiers.
 * « 123 456,7 » ou « 123456.7 » donnent 123456 (le dixième est ignoré, et non collé au nombre) ;
 * « 123.456 » (séparateur de milliers) donne 123456.
 */
export function kmDigits(raw: string | null | undefined): string {
  if (!raw) return "";
  const compact = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/km$/i, "");
  const decimal = compact.match(/^(.*\d)[.,]\d{1,2}$/);
  return (decimal ? decimal[1] : compact).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}
