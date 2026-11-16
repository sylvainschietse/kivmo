import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { json } from "@/server/api";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return json({ status: "ok", database: "ok", time: new Date().toISOString() });
  } catch {
    return json({ status: "degraded", database: "indisponible" }, 503);
  }
}
