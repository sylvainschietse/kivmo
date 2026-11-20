import { cron } from "@/server/api";
import { importStationNames } from "@/integrations/station-names";

// La requête OpenStreetMap pour toute la France peut prendre une à deux minutes.
export const maxDuration = 300;

/** Noms et enseignes des stations depuis OpenStreetMap (hebdomadaire). */
export const POST = cron(async (db) => importStationNames(db));

// Vercel Cron appelle les tâches en GET avec « Authorization: Bearer CRON_SECRET ».
export const GET = POST;
