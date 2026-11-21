/** Dates civiles dans un fuseau horaire (par défaut l'heure de Paris), et non en heure UTC. */

export const DEFAULT_TIME_ZONE = "Europe/Paris";

function safeZone(timeZone: string | null | undefined) {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Jour civil « AAAA-MM-JJ » de l'instant donné, dans le fuseau. */
export function dayInZone(d: Date, timeZone?: string | null) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Décalage (ms) entre l'heure locale du fuseau et l'heure UTC à cet instant. */
function offsetMs(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000;
}

/** Instant de minuit (heure locale du fuseau) pour un jour civil donné (mois de 1 à 12). */
export function zonedMidnight(year: number, month: number, day: number, timeZone?: string | null) {
  const tz = safeZone(timeZone);
  const guess = Date.UTC(year, month - 1, day);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz); // second passage : changement d'heure
  return new Date(t);
}

/** Début du mois en cours (ou de l'année), dans le fuseau. */
export function startOfMonthInZone(now: Date, timeZone?: string | null) {
  const [y, m] = dayInZone(now, timeZone).split("-").map(Number);
  return zonedMidnight(y, m, 1, timeZone);
}

export function startOfYearInZone(now: Date, timeZone?: string | null) {
  const [y] = dayInZone(now, timeZone).split("-").map(Number);
  return zonedMidnight(y, 1, 1, timeZone);
}

/** Dernière milliseconde du jour civil « AAAA-MM-JJ », dans le fuseau. */
export function endOfDayInZone(day: string, timeZone?: string | null) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(zonedMidnight(y, m, d + 1, timeZone).getTime() - 1);
}
