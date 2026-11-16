import { cron } from "@/server/api";
import { purgeDemoAccounts } from "@/server/services/demo";

export const POST = cron(async (db) => purgeDemoAccounts(db));
