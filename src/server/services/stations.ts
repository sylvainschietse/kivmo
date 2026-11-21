import { and, between, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { D, Decimal } from "@/lib/decimal";
import { crowFliesKm } from "@/domain/estimates";
import { FUELS, type FuelCode } from "@/domain/types";
import { AppError, notFound, validation } from "../errors";
import type { Ctx } from "../authz";
import { audit } from "../audit";

/** Au-delà de ce délai, un prix est considéré comme ancien et signalé. */
export const PRICE_STALE_HOURS = 48;
export const REPORT_TTL_HOURS = 48;

export type Availability = "propose" | "rupture_signalee" | "disponible_signale" | "inconnu";
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  propose: "Proposé (disponibilité non confirmée)",
  rupture_signalee: "Rupture signalée",
  disponible_signale: "Disponible signalé",
  inconnu: "Inconnu",
};

export interface FuelPriceView {
  fuel: FuelCode;
  price: Decimal | null;
  observedAt: Date | null;
  source: string | null;
  stale: boolean;
  availability: Availability;
  availabilitySource: string;
  communityPrice: { price: Decimal; at: Date } | null;
  warnings: string[];
}

export interface StationView {
  station: typeof schema.stations.$inferSelect;
  crowFliesKm: number | null;
  fuels: FuelPriceView[];
  isFavorite: boolean;
}

async function buildViews(db: DBOrTx, stations: (typeof schema.stations.$inferSelect)[], ctx: Ctx | null, origin: { lat: number; lng: number } | null, now = new Date()): Promise<StationView[]> {
  if (!stations.length) return [];
  const ids = stations.map((s) => s.id);
  const fuels = await db.select().from(schema.stationFuels).where(inArray(schema.stationFuels.stationId, ids));
  const latestRows = await db
    .selectDistinctOn([schema.priceObservations.stationId, schema.priceObservations.fuel], {
      station_id: schema.priceObservations.stationId,
      fuel: schema.priceObservations.fuel,
      price: schema.priceObservations.price,
      observed_at: schema.priceObservations.observedAt,
      source: schema.priceObservations.source,
    })
    .from(schema.priceObservations)
    .where(and(inArray(schema.priceObservations.stationId, ids), eq(schema.priceObservations.quality, "officielle")))
    .orderBy(schema.priceObservations.stationId, schema.priceObservations.fuel, desc(schema.priceObservations.observedAt));
  const latest = latestRows.map((r) => ({ ...r, fuel: r.fuel as FuelCode }));
  const reports = await db
    .select()
    .from(schema.availabilityReports)
    .where(and(inArray(schema.availabilityReports.stationId, ids), gte(schema.availabilityReports.expiresAt, now), ne(schema.availabilityReports.status, "rejete")))
    .orderBy(desc(schema.availabilityReports.observedAt));
  const favs = ctx ? await db.select().from(schema.favoriteStations).where(and(eq(schema.favoriteStations.userId, ctx.userId), inArray(schema.favoriteStations.stationId, ids))) : [];

  return stations.map((s) => {
    const sf = fuels.filter((f) => f.stationId === s.id);
    const fuelCodes = new Set<FuelCode>([...sf.map((f) => f.fuel as FuelCode), ...latest.filter((l) => l.station_id === s.id).map((l) => l.fuel)]);
    const views: FuelPriceView[] = [...fuelCodes].map((fuel) => {
      const obs = latest.find((l) => l.station_id === s.id && l.fuel === fuel);
      const base = sf.find((f) => f.fuel === fuel);
      const rep = reports.find((r) => r.stationId === s.id && r.fuel === fuel && (r.kind === "rupture" || r.kind === "disponible"));
      const priceRep = reports.find((r) => r.stationId === s.id && r.fuel === fuel && r.kind === "prix" && r.reportedPrice);
      let availability: Availability = (base?.availability as Availability) ?? "inconnu";
      let availabilitySource = base ? `Source : ${s.source}` : "Aucune information";
      if (rep) {
        availability = rep.kind === "rupture" ? "rupture_signalee" : "disponible_signale";
        availabilitySource = `Signalement communautaire du ${rep.observedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
      }
      const observedAt = obs ? new Date(obs.observed_at) : null;
      const stale = observedAt ? now.getTime() - observedAt.getTime() > PRICE_STALE_HOURS * 3_600_000 : true;
      const warnings: string[] = [];
      if (!obs) warnings.push("Aucun prix daté disponible.");
      else if (stale) warnings.push(`Prix ancien (plus de ${PRICE_STALE_HOURS} h) : il peut avoir changé.`);
      if (availability === "rupture_signalee") warnings.push("Rupture signalée : disponibilité incertaine.");
      if (availability === "propose") warnings.push("Un prix présent ne prouve pas la disponibilité.");
      return {
        fuel,
        price: obs ? D(obs.price) : null,
        observedAt,
        source: obs?.source ?? null,
        stale,
        availability,
        availabilitySource,
        communityPrice: priceRep ? { price: D(priceRep.reportedPrice!), at: priceRep.observedAt } : null,
        warnings,
      };
    });
    return {
      station: s,
      crowFliesKm: origin ? crowFliesKm(origin, { lat: s.lat, lng: s.lng }) : null,
      fuels: views.sort((a, b) => FUELS.indexOf(a.fuel) - FUELS.indexOf(b.fuel)),
      isFavorite: favs.some((f) => f.stationId === s.id),
    };
  });
}

export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusKm: number;
  fuel?: FuelCode | null;
  maxPriceAgeHours?: number | null;
  excludeRupture?: boolean;
  brand?: string | null;
  service?: string | null;
  openNow?: boolean;
  includeDemo?: boolean;
  limit?: number;
  sort?: StationSort;
}

export const STATION_SORTS = { prix: "Prix", distance: "Distance", recent: "Mise à jour", nom: "Nom" } as const;
export type StationSort = keyof typeof STATION_SORTS;

type View = Awaited<ReturnType<typeof buildViews>>[number];

/**
 * Tri des stations. « prix » : prix frais croissant (prix anciens ou inconnus à la fin) puis distance ;
 * « recent » : prix le plus récemment mis à jour d'abord. Sans carburant choisi, « prix » trie par distance.
 */
export function sortStations<T extends View>(views: T[], sort: StationSort, fuel: FuelCode | null): T[] {
  const dist = (v: T) => v.crowFliesKm ?? Infinity;
  const fuelOf = (v: T) => (fuel ? v.fuels.find((f) => f.fuel === fuel) : undefined);
  const price = (v: T) => { const f = fuelOf(v); return f?.price && !f.stale ? f.price.toNumber() : Infinity; };
  const updated = (v: T) => {
    const dates = (fuel ? [fuelOf(v)] : v.fuels).map((f) => f?.observedAt?.getTime() ?? 0);
    return Math.max(0, ...dates);
  };
  const name = (v: T) => (v.station.name ?? v.station.brand ?? v.station.address ?? "").toLocaleLowerCase("fr");
  const cmp: Record<StationSort, (a: T, b: T) => number> = {
    prix: (a, b) => (fuel ? price(a) - price(b) || 0 : 0) || dist(a) - dist(b),
    distance: (a, b) => dist(a) - dist(b),
    recent: (a, b) => updated(b) - updated(a) || dist(a) - dist(b),
    nom: (a, b) => name(a).localeCompare(name(b), "fr") || dist(a) - dist(b),
  };
  // Infinity - Infinity donne NaN : on le ramène à 0 pour garder un tri stable.
  return [...views].sort((a, b) => cmp[sort](a, b) || 0);
}

/**
 * Recherche autour d'une position. Classement économique : prix frais croissant puis distance ;
 * indépendant de toute rémunération (les offres sponsorisées sont affichées à part).
 */
export async function nearbyStations(db: DBOrTx, ctx: Ctx | null, q: NearbyQuery) {
  if (!Number.isFinite(q.lat) || !Number.isFinite(q.lng)) throw validation("Position invalide.");
  const radius = Math.min(Math.max(q.radiusKm, 1), 100);
  const dLat = radius / 111;
  const dLng = radius / (111 * Math.cos((q.lat * Math.PI) / 180));
  const rows = await db
    .select()
    .from(schema.stations)
    .where(
      and(
        between(schema.stations.lat, q.lat - dLat, q.lat + dLat),
        between(schema.stations.lng, q.lng - dLng, q.lng + dLng),
        q.includeDemo ? undefined : eq(schema.stations.isDemo, false),
        // Carburant filtré avant la limite : en ville dense, aucune station utile n'est écartée.
        q.fuel ? sql`exists (select 1 from station_fuels sf where sf.station_id = ${schema.stations.id} and sf.fuel = ${q.fuel})` : undefined,
      ),
    )
    // Les plus proches d'abord (distance approchée), pour que la limite écarte les plus lointaines.
    .orderBy(sql`power(${schema.stations.lat} - ${q.lat}, 2) + power((${schema.stations.lng} - ${q.lng}) * ${Math.cos((q.lat * Math.PI) / 180)}, 2)`)
    .limit(500);
  let views = (await buildViews(db, rows, ctx, { lat: q.lat, lng: q.lng })).filter((v) => (v.crowFliesKm ?? 0) <= radius);
  if (q.brand) views = views.filter((v) => v.station.brand?.toLowerCase().includes(q.brand!.toLowerCase()));
  if (q.service) views = views.filter((v) => v.station.services.some((s) => s.toLowerCase().includes(q.service!.toLowerCase())));
  if (q.openNow) views = views.filter((v) => v.station.isAlwaysOpen === true);
  if (q.fuel) {
    views = views.filter((v) => v.fuels.some((f) => f.fuel === q.fuel));
    if (q.excludeRupture) views = views.filter((v) => v.fuels.find((f) => f.fuel === q.fuel)?.availability !== "rupture_signalee");
    if (q.maxPriceAgeHours) views = views.filter((v) => {
      const f = v.fuels.find((x) => x.fuel === q.fuel);
      return f?.observedAt && Date.now() - f.observedAt.getTime() <= q.maxPriceAgeHours! * 3_600_000;
    });
  }
  views = sortStations(views, q.sort ?? (q.fuel ? "prix" : "distance"), q.fuel ?? null);
  return views.slice(0, q.limit ?? 50);
}

export async function searchStationsByText(db: DBOrTx, ctx: Ctx | null, text: string, includeDemo = false) {
  const t = text.trim();
  if (t.length < 2) return [];
  const rows = await db
    .select()
    .from(schema.stations)
    .where(and(sql`(${schema.stations.city} ilike ${"%" + t + "%"} or ${schema.stations.postalCode} like ${t + "%"} or ${schema.stations.address} ilike ${"%" + t + "%"} or ${schema.stations.name} ilike ${"%" + t + "%"})`, includeDemo ? undefined : eq(schema.stations.isDemo, false)))
    .orderBy(schema.stations.city, schema.stations.name, schema.stations.address)
    .limit(30);
  return buildViews(db, rows, ctx, null);
}

export async function stationDetail(db: DBOrTx, ctx: Ctx | null, stationId: string, origin: { lat: number; lng: number } | null) {
  const [s] = await db.select().from(schema.stations).where(eq(schema.stations.id, stationId));
  if (!s) throw notFound("Station introuvable.");
  const [view] = await buildViews(db, [s], ctx, origin);
  const history = await db.select().from(schema.priceObservations).where(eq(schema.priceObservations.stationId, stationId)).orderBy(desc(schema.priceObservations.observedAt)).limit(30);
  const reports = await db.select().from(schema.availabilityReports).where(eq(schema.availabilityReports.stationId, stationId)).orderBy(desc(schema.availabilityReports.observedAt)).limit(20);
  return { ...view, history, reports };
}

export async function toggleFavorite(db: DB, ctx: Ctx, stationId: string) {
  const [f] = await db.select().from(schema.favoriteStations).where(and(eq(schema.favoriteStations.userId, ctx.userId), eq(schema.favoriteStations.stationId, stationId)));
  if (f) {
    await db.delete(schema.favoriteStations).where(eq(schema.favoriteStations.id, f.id));
    return false;
  }
  await db.insert(schema.favoriteStations).values({ userId: ctx.userId, stationId });
  return true;
}

export async function favoriteStations(db: DBOrTx, ctx: Ctx) {
  const favs = await db.select({ s: schema.stations }).from(schema.favoriteStations).innerJoin(schema.stations, eq(schema.stations.id, schema.favoriteStations.stationId)).where(eq(schema.favoriteStations.userId, ctx.userId));
  return buildViews(db, favs.map((f) => f.s), ctx, null);
}

/**
 * Signalement communautaire : daté, sourcé, expirant, modérable, limité (anti-abus).
 * Un signalement de prix ne remplace jamais le prix officiel : il est affiché à part.
 */
export async function reportStation(db: DB, ctx: Ctx, input: { stationId: string; fuel?: FuelCode | null; kind: "rupture" | "disponible" | "prix" | "fermeture"; reportedPrice?: string | null }) {
  const [s] = await db.select().from(schema.stations).where(eq(schema.stations.id, input.stationId));
  if (!s) throw notFound("Station introuvable.");
  if (input.kind !== "fermeture" && !input.fuel) throw validation("Précisez le carburant concerné.");
  if (input.kind === "prix" && !(input.reportedPrice && /^\d+([.,]\d+)?$/.test(input.reportedPrice))) throw validation("Prix signalé invalide.");
  const [{ recent }] = await db.select({ recent: sql<number>`count(*)::int` }).from(schema.availabilityReports).where(and(eq(schema.availabilityReports.reportedBy, ctx.userId), gte(schema.availabilityReports.createdAt, new Date(Date.now() - 3_600_000))));
  if (recent >= 10) throw new AppError("RATE_LIMITED", "Trop de signalements récents. Réessayez plus tard.");
  const [row] = await db
    .insert(schema.availabilityReports)
    .values({ stationId: s.id, fuel: input.fuel ?? null, kind: input.kind, reportedPrice: input.reportedPrice?.replace(",", ".") ?? null, reportedBy: ctx.userId, expiresAt: new Date(Date.now() + REPORT_TTL_HOURS * 3_600_000) })
    .returning();
  await audit(db, { actorUserId: ctx.userId, action: "station.report", resourceType: "station", resourceId: s.id, details: { kind: input.kind, fuel: input.fuel } });
  return row;
}

export async function moderateReport(db: DB, ctx: Ctx, reportId: string, decision: "accepte" | "rejete", note?: string) {
  if (!ctx.isPlatformAdmin) throw new AppError("FORBIDDEN", "Réservé à la modération KIVMO.");
  await db.update(schema.availabilityReports).set({ status: decision, moderatedBy: ctx.userId, moderationNote: note ?? null }).where(eq(schema.availabilityReports.id, reportId));
  await audit(db, { actorUserId: ctx.userId, action: `report.${decision}`, resourceType: "availability_report", resourceId: reportId });
}

/** Lien vers l'application de navigation choisie (la navigation guidée est déléguée). */
export function navigationUrl(app: string, lat: number, lng: number) {
  switch (app) {
    case "waze":
      return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    case "apple":
      return `https://maps.apple.com/?daddr=${lat},${lng}`;
    case "osm":
      return `https://www.openstreetmap.org/directions?to=${lat},${lng}`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
}
