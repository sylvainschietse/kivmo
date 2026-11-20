import { cron } from "@/server/api";
import { purgeDemoAccounts } from "@/server/services/demo";

export const POST = cron(async (db) => purgeDemoAccounts(db));

// Vercel Cron appelle les tâches en GET avec « Authorization: Bearer CRON_SECRET ».
export const GET = POST;
