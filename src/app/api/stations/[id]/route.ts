import { api } from "@/server/api";
import { stationDetail } from "@/server/services/stations";

export const GET = api<{ id: string }>(async ({ req, db, ctx, params }) => {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  return stationDetail(db, ctx, params.id, Number.isFinite(lat) && Number.isFinite(lng) && req.nextUrl.searchParams.has("lat") ? { lat, lng } : null);
});
