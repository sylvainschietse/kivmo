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
      const observedAt = new Date(String(m));
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

/** Écrit les stations et observations (idempotent : une observation identique n'est pas dupliquée). */
export async function upsertParsedStations(db: DB, parsed: ParsedStation[], source = SOURCE_KEY) {
  let stations = 0;
  let observations = 0;
  for (const p of parsed) {
    const [st] = await db
      .insert(schema.stations)
      .values({ source, sourceId: p.sourceId, address: p.address, city: p.city, postalCode: p.postalCode, lat: p.lat, lng: p.lng, services: p.services, isAlwaysOpen: p.isAlwaysOpen })
      .onConflictDoUpdate({ target: [schema.stations.source, schema.stations.sourceId], set: { address: p.address, city: p.city, postalCode: p.postalCode, lat: p.lat, lng: p.lng, services: p.services, isAlwaysOpen: p.isAlwaysOpen, updatedAt: new Date() } })
      .returning();
    stations++;
    for (const fuel of new Set([...p.offered, ...p.unavailable])) {
      const availability = p.unavailable.includes(fuel) ? "rupture_signalee" : "propose";
      await db
        .insert(schema.stationFuels)
        .values({ stationId: st.id, fuel, availability, availabilitySince: new Date() })
        .onConflictDoUpdate({ target: [schema.stationFuels.stationId, schema.stationFuels.fuel], set: { availability, updatedAt: new Date() } });
    }
    for (const pr of p.prices) {
      const res = await db.insert(schema.priceObservations).values({ stationId: st.id, fuel: pr.fuel, price: pr.price, source, observedAt: pr.observedAt, quality: "officielle" }).onConflictDoNothing().returning({ id: schema.priceObservations.id });
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
  if (!env.fuelPricesEnabled && !opts.fetchImpl) throw new Error("Connecteur prix-carburants non activé (FUEL_PRICES_SOURCE).");
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

export async function lastImport(db: DB) {
  const [h] = await db.select().from(schema.integrationHealth).where(and(eq(schema.integrationHealth.key, SOURCE_KEY)));
  return h ?? null;
}

export { sql };
