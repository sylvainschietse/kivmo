import { cron } from "@/server/api";
import { reconcilePaymentOrders } from "@/server/services/savings";

export const POST = cron(async (db) => ({ reconciled: await reconcilePaymentOrders(db) }));
