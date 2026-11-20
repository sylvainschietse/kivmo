import { cron } from "@/server/api";
import { reconcilePaymentOrders } from "@/server/services/savings";

export const POST = cron(async (db) => ({ reconciled: await reconcilePaymentOrders(db) }));

// Vercel Cron appelle les tâches en GET avec « Authorization: Bearer CRON_SECRET ».
export const GET = POST;
