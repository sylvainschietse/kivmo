import { cron } from "@/server/api";
import { importFuelPrices } from "@/integrations/fuel-prices";

/** Import planifié : ?department=75 ou ?lat=&lng=&radiusKm= */
export const POST = cron(async (db, req) => {
  const q = req.nextUrl.searchParams;
  return importFuelPrices(db, {
    department: q.get("department") ?? undefined,
    lat: q.has("lat") ? Number(q.get("lat")) : undefined,
    lng: q.has("lng") ? Number(q.get("lng")) : undefined,
    radiusKm: q.has("radiusKm") ? Number(q.get("radiusKm")) : undefined,
  });
});

// Vercel Cron appelle les tâches en GET avec « Authorization: Bearer CRON_SECRET ».
export const GET = POST;
