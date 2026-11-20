import { cron } from "@/server/api";
import { importAllFuelPrices, importFuelPrices } from "@/integrations/fuel-prices";

// L'import de toute la France peut prendre plus d'une minute.
export const maxDuration = 300;

/** Import planifié : toute la France par défaut, ou une zone avec ?department=75 ou ?lat=&lng=&radiusKm= */
export const POST = cron(async (db, req) => {
  const q = req.nextUrl.searchParams;
  if (!q.has("department") && !q.has("lat")) return importAllFuelPrices(db);
  return importFuelPrices(db, {
    department: q.get("department") ?? undefined,
    lat: q.has("lat") ? Number(q.get("lat")) : undefined,
    lng: q.has("lng") ? Number(q.get("lng")) : undefined,
    radiusKm: q.has("radiusKm") ? Number(q.get("radiusKm")) : undefined,
  });
});

// Vercel Cron appelle les tâches en GET avec « Authorization: Bearer CRON_SECRET ».
export const GET = POST;
