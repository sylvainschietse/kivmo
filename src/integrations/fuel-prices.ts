import { and, eq, sql } from "drizzle-orm";
import { schema, type DB } from "@/db/client";
import type { FuelCode } from "@/domain/types";
import { env } from "@/server/env";

/**
 * Connecteur « prix-carburants » (flux instantané v2, publié sur data.economie.gouv.fr via
 * l'API Explore v2.1 d'Opendatasoft). Conditions d'utilisation, licence, quotas et fraîcheur
 * à vérifier auprès de la source officielle avant mise en service (§15).
 *
 * Import côté serveur uniquement, avec cache en base : les mobiles ne téléchargent jamais le flux.
 */
export const SOURCE_KEY = "prix-carburants";

/** Correspondance des noms de carburants du flux vers nos codes. */
const FUEL_MAP: Record<string, FuelCode> = {
  gazole: "GAZOLE",
  sp95: "SP95",
  e10: "SP95_E10",
  sp98: "SP98",
  e85: "E85",
  gplc: "GPL",
};

export interface FeedRecord {
  id: number | string;
  adresse?: string;
  ville?: string;
  cp?: string;
  latitude?: string | number;
  longitude?: string | number;
  geom?: { lat: number; lon: number } | null;
  horaires_automate_24_24?: string | null;
  services_service?: string[] | string | null;
  carburants_disponibles?: string[] | string | null;
  carburants_indisponibles?: string[] | string | null;
  [key: string]: unknown;
}

export interface ParsedStation {
  sourceId: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  lat: number;
  lng: number;
  services: string[];
  isAlwaysOpen: boolean | null;
  prices: { fuel: FuelCode; price: string; observedAt: Date }[];
  offered: FuelCode[];
  unavailable: FuelCode[];
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(/[;,]/).map((x) => x.trim()) : []);

function fuelFromLabel(label: string): FuelCode | null {
  const k = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FUEL_MAP[k] ?? null;
}

/**
 * Le flux publie l'heure légale française suivie de « +00:00 » (constaté : des mises à jour
 * datées dans le futur). On lit donc la date et l'heure telles quelles, comme heure de Paris.
 */
export function parseFeedDate(raw: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) return new Date(raw);
  const [, y, mo, d, h, mi, se] = m.map(Number) as number[];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, se || 0);
  // Décalage de Paris à cet instant (1 h en hiver, 2 h en été).
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const parisAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(asUtc - (parisAsUtc - asUtc));
}

/** Analyse tolérante d'un enregistrement : un champ manquant n'invente jamais de valeur. */
export function parseFeedRecord(r: FeedRecord): ParsedStation | null {
  let lat: number | null = r.geom?.lat ?? null;
  let lng: number | null = r.geom?.lon ?? null;
  if (lat === null && r.latitude !== undefined) lat = Number(r.latitude) / (Math.abs(Number(r.latitude)) > 1000 ? 100000 : 1);
  if (lng === null && r.longitude !== undefined) lng = Number(r.longitude) / (Math.abs(Number(r.longitude)) > 1000 ? 100000 : 1);
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const prices: ParsedStation["prices"] = [];
  for (const [key, fuel] of Object.entries(FUEL_MAP)) {
    const p = r[`${key}_prix`];
    const m = r[`${key}_maj`];
    if (p !== null && p !== undefined && p !== "" && m) {
      const price = String(p);
      const observedAt = parseFeedDate(String(m));
      if (/^\d+(\.\d+)?$/.test(price) && !Number.isNaN(observedAt.getTime())) prices.push({ fuel, price, observedAt });
    }
  }
  const offered = asList(r.carburants_disponibles).map(fuelFromLabel).filter(Boolean) as FuelCode[];
  const unavailable = asList(r.carburants_indisponibles).map(fuelFromLabel).filter(Boolean) as FuelCode[];
  return {
    sourceId: String(r.id),
    address: r.adresse ?? null,
    city: r.ville ?? null,
    postalCode: r.cp ?? null,
    lat,
    lng,
    services: asList(r.services_service),
    isAlwaysOpen: r.horaires_automate_24_24 === "Oui" ? true : r.horaires_automate_24_24 === "Non" ? false : null,
    prices,
    offered: [...new Set([...offered, ...prices.map((p) => p.fuel)])],
    unavailable,
  };
}

/** Écrit les stations et observations par lots (idempotent : une observation identique n'est pas dupliquée). */
export async function upsertParsedStations(db: DB, parsed: ParsedStation[], source = SOURCE_KEY) {
  let stations = 0;
  let observations = 0;
  // Un même identifiant ne peut apparaître qu'une fois par instruction « on conflict ».
  const unique = [...new Map(parsed.map((p) => [p.sourceId, p])).values()];
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const rows = await db
      .insert(schema.stations)
      .values(batch.map((p) => ({ source, sourceId: p.sourceId, address: p.address, city: p.city, postalCode: p.postalCode, lat: p.lat, lng: p.lng, services: p.services, isAlwaysOpen: p.isAlwaysOpen })))
      .onConflictDoUpdate({
        target: [schema.stations.source, schema.stations.sourceId],
        set: {
          address: sql`excluded.address`,
          city: sql`excluded.city`,
          postalCode: sql`excluded.postal_code`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
          services: sql`excluded.services`,
          isAlwaysOpen: sql`excluded.is_always_open`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.stations.id, sourceId: schema.stations.sourceId });
    stations += rows.length;
    const idOf = new Map(rows.map((r) => [r.sourceId, r.id]));
    const fuels = batch.flatMap((p) =>
      [...new Set([...p.offered, ...p.unavailable])].map((fuel) => ({
        stationId: idOf.get(p.sourceId)!,
        fuel,
        availability: (p.unavailable.includes(fuel) ? "rupture_signalee" : "propose") as "rupture_signalee" | "propose",
        availabilitySince: new Date(),
      })),
    );
    if (fuels.length) {
      await db
        .insert(schema.stationFuels)
        .values(fuels)
        .onConflictDoUpdate({ target: [schema.stationFuels.stationId, schema.stationFuels.fuel], set: { availability: sql`excluded.availability`, updatedAt: new Date() } });
    }
    const prices = batch.flatMap((p) => p.prices.map((pr) => ({ stationId: idOf.get(p.sourceId)!, fuel: pr.fuel, price: pr.price, source, observedAt: pr.observedAt, quality: "officielle" })));
    for (let j = 0; j < prices.length; j += 1000) {
      const res = await db.insert(schema.priceObservations).values(prices.slice(j, j + 1000)).onConflictDoNothing().returning({ id: schema.priceObservations.id });
      observations += res.length;
    }
  }
  return { stations, observations };
}

async function recordHealth(db: DB, ok: boolean, metrics: Record<string, unknown>, error?: string) {
  await db
    .insert(schema.integrationHealth)
    .values({ key: SOURCE_KEY, status: ok ? "ok" : "erreur", lastSuccessAt: ok ? new Date() : null, lastErrorAt: ok ? null : new Date(), lastError: error ?? null, metrics })
    .onConflictDoUpdate({
      target: schema.integrationHealth.key,
      set: ok ? { status: "ok", lastSuccessAt: new Date(), metrics, updatedAt: new Date() } : { status: "erreur", lastErrorAt: new Date(), lastError: error ?? null, updatedAt: new Date() },
    });
}

/**
 * Import autour d'un point (rayon en km) ou d'un département. Pagination, reprise au dernier
 * offset en cas d'erreur réseau, journal d'erreurs, métriques. Les derniers prix datés restent
 * en base si la source est indisponible.
 */
export async function importFuelPrices(db: DB, opts: { lat?: number; lng?: number; radiusKm?: number; department?: string; maxRecords?: number; fetchImpl?: typeof fetch }) {
  if (!env.fuelPricesEnabled && !opts.fetchImpl) throw new Error("Connecteur prix-carburants désactivé (FUEL_PRICES_SOURCE=off).");
  const f = opts.fetchImpl ?? fetch;
  const [job] = await db.insert(schema.importJobs).values({ kind: SOURCE_KEY, stats: opts }).returning();
  const where: string[] = [];
  if (opts.lat !== undefined && opts.lng !== undefined) where.push(`within_distance(geom, geom'POINT(${opts.lng} ${opts.lat})', ${opts.radiusKm ?? 10}km)`);
  if (opts.department) where.push(`code_departement="${opts.department.replace(/[^0-9AB]/g, "")}"`);
  const pageSize = 100;
  const max = opts.maxRecords ?? 2000;
  let offset = 0;
  let total = 0;
  let stats = { stations: 0, observations: 0 };
  const errors: string[] = [];
  try {
    while (offset < max) {
      const url = new URL(env.fuelPricesApiUrl);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));
      if (where.length) url.searchParams.set("where", where.join(" and "));
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await f(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
          if (res.ok) break;
          errors.push(`HTTP ${res.status} (offset ${offset})`);
        } catch (e) {
          errors.push(`${(e as Error).message} (offset ${offset})`);
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
      if (!res?.ok) throw new Error(errors.at(-1) ?? "Source indisponible");
      const body = (await res.json()) as { total_count: number; results: FeedRecord[] };
      total = body.total_count;
      const parsed = body.results.map(parseFeedRecord).filter(Boolean) as ParsedStation[];
      const s = await upsertParsedStations(db, parsed);
      stats = { stations: stats.stations + s.stations, observations: stats.observations + s.observations };
      offset += pageSize;
      if (offset >= total || body.results.length === 0) break;
    }
    await db.update(schema.importJobs).set({ status: "termine", finishedAt: new Date(), stats: { ...stats, total, errors } }).where(eq(schema.importJobs.id, job.id));
    await recordHealth(db, true, { ...stats, total, lastImportJob: job.id });
    return { ok: true as const, ...stats, total };
  } catch (e) {
    await db.update(schema.importJobs).set({ status: "erreur", finishedAt: new Date(), error: (e as Error).message, stats: { ...stats, offset, errors } }).where(eq(schema.importJobs.id, job.id));
    await recordHealth(db, false, {}, (e as Error).message);
    return { ok: false as const, error: (e as Error).message, ...stats };
  }
}

/** Import de toutes les stations de France via l'export JSON du jeu de données (tâche planifiée). */
export async function importAllFuelPrices(db: DB, opts: { fetchImpl?: typeof fetch } = {}) {
  if (!env.fuelPricesEnabled && !opts.fetchImpl) throw new Error("Connecteur prix-carburants désactivé (FUEL_PRICES_SOURCE=off).");
  const f = opts.fetchImpl ?? fetch;
  const [job] = await db.insert(schema.importJobs).values({ kind: SOURCE_KEY, stats: { scope: "france" } }).returning();
  try {
    const url = env.fuelPricesApiUrl.replace(/\/records$/, "/exports/json");
    const res = await f(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const records = (await res.json()) as FeedRecord[];
    const parsed = records.map(parseFeedRecord).filter(Boolean) as ParsedStation[];
    const stats = await upsertParsedStations(db, parsed);
    await db.update(schema.importJobs).set({ status: "termine", finishedAt: new Date(), stats: { ...stats, total: records.length, scope: "france" } }).where(eq(schema.importJobs.id, job.id));
    await recordHealth(db, true, { ...stats, total: records.length, scope: "france", lastImportJob: job.id });
    return { ok: true as const, ...stats, total: records.length };
  } catch (e) {
    await db.update(schema.importJobs).set({ status: "erreur", finishedAt: new Date(), error: (e as Error).message }).where(eq(schema.importJobs.id, job.id));
    await recordHealth(db, false, {}, (e as Error).message);
    return { ok: false as const, error: (e as Error).message };
  }
}

/**
 * Rafraîchit les prix autour d'un point si la zone n'a pas de prix récent (moins de 3 h).
 * Une même zone (maille d'environ 10 km) n'est interrogée qu'une fois toutes les 3 heures,
 * même quand les prix n'ont pas changé (aucune nouvelle ligne enregistrée).
 * En cas d'échec de la source, les derniers prix datés restent affichés.
 */
export async function refreshAreaIfStale(db: DB, lat: number, lng: number, radiusKm: number) {
  if (!env.fuelPricesEnabled || !Number.isFinite(lat) || !Number.isFinite(lng)) return { refreshed: false as const };
  const radius = Math.min(Math.max(radiusKm, 1), 30);
  const dLat = radius / 111;
  const dLng = radius / (111 * Math.cos((lat * Math.PI) / 180));
  const [fresh] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from price_observations po join stations s on s.id = po.station_id
    where s.is_demo = false and s.lat between ${lat - dLat} and ${lat + dLat} and s.lng between ${lng - dLng} and ${lng + dLng}
      and po.fetched_at > now() - interval '3 hours'`);
  if (Number(fresh?.n ?? 0) > 0) return { refreshed: false as const };
  const cell = `${Math.round(lat * 10)}:${Math.round(lng * 10)}`;
  const [slot] = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${"prix-zone:" + cell}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - interval '3 hours' then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - interval '3 hours' then now() else rate_limits.window_start end
    returning count`);
  if (Number(slot?.count ?? 0) > 1) return { refreshed: false as const };
  const r = await importFuelPrices(db, { lat, lng, radiusKm: Math.max(radius, 10), maxRecords: 500 });
  return { refreshed: r.ok };
}

export async function lastImport(db: DB) {
  const [h] = await db.select().from(schema.integrationHealth).where(and(eq(schema.integrationHealth.key, SOURCE_KEY)));
  return h ?? null;
}

export { sql };
