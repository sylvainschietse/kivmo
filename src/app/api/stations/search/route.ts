import { api } from "@/server/api";
import { stationTitle } from "@/integrations/station-names";
import { searchStationsByText } from "@/server/services/stations";

export const GET = api(async ({ req, db, ctx }) => {
  const views = await searchStationsByText(db, ctx, req.nextUrl.searchParams.get("q") ?? "", ctx.isDemo);
  return views.map((v) => ({
    id: v.station.id,
    name: stationTitle(v.station),
    address: [v.station.address, v.station.postalCode, v.station.city].filter(Boolean).join(" "),
    crowFliesKm: null,
    isDemo: v.station.isDemo,
    fuels: v.fuels.map((f) => ({ fuel: f.fuel, price: f.price?.toString() ?? null, observedAt: f.observedAt, stale: f.stale, availability: f.availability })),
  }));
});
