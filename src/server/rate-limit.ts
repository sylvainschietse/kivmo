import { sql } from "drizzle-orm";
import type { DBOrTx } from "@/db/client";
import { AppError } from "./errors";

/** Limitation de débit en base (fenêtre fixe) — fonctionne avec plusieurs instances. */
export async function checkRateLimit(db: DBOrTx, key: string, max: number, windowSeconds: number) {
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`);
  if (Number(rows[0]?.count ?? 0) > max) throw new AppError("RATE_LIMITED", "Trop de tentatives. Réessayez dans quelques minutes.");
}
