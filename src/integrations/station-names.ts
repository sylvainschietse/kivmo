import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { SOURCE_KEY } from "@/integrations/fuel-prices";
import { env } from "@/server/env";

/**
 * Noms et enseignes des stations depuis OpenStreetMap (licence ODbL, attribution affichée).
 * Le flux officiel des prix ne publie ni nom ni enseigne. On les rapproche par l'identifiant
 * « ref:FR:prix-carburants » quand il est renseigné dans OpenStreetMap, sinon par la position
 * (station OSM la plus proche à moins de 150 m, si elle n'est pas déjà rattachée ailleurs).
 */
export const NAMES_SOURCE = "openstreetmap";
const MAX_DISTANCE_M = 150;

export interface OsmFuel {
  ref: string | null;
  name: string | null;
  brand: string | null;
  lat: number;
  lng: number;
}

interface OverpassElement {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const clean = (v: string | undefined) => {
  const s = v?.trim();
  return s ? s.slice(0, 120) : null;
};

/** Requête Overpass : toutes les stations-service de France métropolitaine et d'outre-mer. */
export const OVERPASS_QUERY =
  '[out:json][timeout:240];area["ISO3166-1"="FR"][admin_level=2]->.fr;nwr["amenity"="fuel"](area.fr);out tags center;';

export function parseOverpass(elements: OverpassElement[]): OsmFuel[] {
  const out: OsmFuel[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const t = e.tags ?? {};
    if (lat == null || lng == null) continue;
    const name = clean(t.name);
    const brand = clean(t.brand) ?? clean(t.operator);
    if (!name && !brand) continue;
    out.push({ ref: clean(t["ref:FR:prix-carburants"]), name, brand, lat, lng });
  }
  return out;
}

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Rapproche nos stations des stations OSM : identifiant d'abord, position ensuite. */
export function matchStations(ours: { id: string; sourceId: string; lat: number; lng: number }[], osm: OsmFuel[]) {
  const byRef = new Map<string, OsmFuel>();
  for (const o of osm) if (o.ref) for (const r of o.ref.split(";")) byRef.set(r.trim(), o);

  const used = new Set<OsmFuel>();
  const result = new Map<string, OsmFuel>();
  const rest: typeof ours = [];
  for (const s of ours) {
    const o = byRef.get(s.sourceId);
    if (o) {
      result.set(s.id, o);
      used.add(o);
    } else rest.push(s);
  }

  // Grille d'environ 1 km pour la recherche par position.
  const cell = (lat: number, lng: number) => `${Math.floor(lat * 100)}:${Math.floor(lng * 100)}`;
  const grid = new Map<string, OsmFuel[]>();
  for (const o of osm) {
    if (used.has(o)) continue;
    const k = cell(o.lat, o.lng);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(o);
  }
  const candidates: { s: string; o: OsmFuel; d: number }[] = [];
  for (const s of rest) {
    const la = Math.floor(s.lat * 100);
    const ln = Math.floor(s.lng * 100);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const o of grid.get(`${la + i}:${ln + j}`) ?? []) {
          const d = distanceM(s.lat, s.lng, o.lat, o.lng);
          if (d <= MAX_DISTANCE_M) candidates.push({ s: s.id, o, d });
        }
  }
  // Les paires les plus proches d'abord ; une station OSM ne sert qu'une fois.
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) {
    if (result.has(c.s) || used.has(c.o)) continue;
    result.set(c.s, c.o);
    used.add(c.o);
  }
  return result;
}

/** Libellé affiché d'une station : nom, sinon enseigne, sinon adresse. */
export function stationTitle(st: { name: string | null; brand: string | null; address?: string | null; city?: string | null }) {
  return st.name ?? st.brand ?? ([st.address, st.city].filter(Boolean).join(", ") || "Station");
}

/** Import des noms et enseignes (tâche planifiée hebdomadaire). */
export async function importStationNames(db: DB, opts: { fetchImpl?: typeof fetch } = {}) {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(env.overpassUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "KIVMO/1.0 (import hebdomadaire des enseignes)" },
    body: new URLSearchParams({ data: OVERPASS_QUERY }).toString(),
    signal: AbortSignal.timeout(250_000),
  });
  if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` };
  const body = (await res.json()) as { elements?: OverpassElement[] };
  const osm = parseOverpass(body.elements ?? []);

  const ours = await db.execute<{ id: string; source_id: string; lat: number; lng: number }>(
    sql`select id, source_id, lat, lng from stations where source = ${SOURCE_KEY} and is_demo = false`,
  );
  const matches = matchStations(
    [...ours].map((r) => ({ id: r.id, sourceId: r.source_id, lat: Number(r.lat), lng: Number(r.lng) })),
    osm,
  );

  const rows = [...matches].map(([id, o]) => ({ id, name: o.name, brand: o.brand }));
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await db.execute(sql`
      update stations s set name = v.name, brand = v.brand, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as v(id uuid, name text, brand text)
      where s.id = v.id and (s.name is distinct from v.name or s.brand is distinct from v.brand)`);
  }
  return { ok: true as const, osmStations: osm.length, stations: ours.length, matched: rows.length };
}
