import { api } from "@/server/api";
import { stationTitle } from "@/integrations/station-names";
import { nearbyStations } from "@/server/services/stations";
import type { FuelCode } from "@/domain/types";

export const GET = api(async ({ req, db, ctx }) => {
  const q = req.nextUrl.searchParams;
  const views = await nearbyStations(db, ctx, {
    lat: Number(q.get("lat")),
    lng: Number(q.get("lng")),
    radiusKm: Number(q.get("radiusKm") ?? 10),
    fuel: (q.get("fuel") as FuelCode) || null,
    excludeRupture: q.get("excludeRupture") === "1",
    maxPriceAgeHours: q.get("maxAgeHours") ? Number(q.get("maxAgeHours")) : null,
    brand: q.get("brand"),
    includeDemo: ctx.isDemo,
    limit: 30,
  });
  return views.map((v) => ({
    id: v.station.id,
    name: stationTitle(v.station),
    address: [v.station.address, v.station.postalCode, v.station.city].filter(Boolean).join(" "),
    lat: v.station.lat,
    lng: v.station.lng,
    crowFliesKm: v.crowFliesKm,
    distanceKind: "vol_d_oiseau",
    source: v.station.source,
    isDemo: v.station.isDemo,
    fuels: v.fuels.map((f) => ({ fuel: f.fuel, price: f.price?.toString() ?? null, observedAt: f.observedAt, source: f.source, stale: f.stale, availability: f.availability, warnings: f.warnings })),
  }));
});
