import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DBOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __kivmoSql?: ReturnType<typeof postgres>; __kivmoDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__kivmoDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL manquant : voir .env.example");
    globalForDb.__kivmoSql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10), prepare: false });
    globalForDb.__kivmoDb = drizzle(globalForDb.__kivmoSql, { schema });
  }
  return globalForDb.__kivmoDb;
}

export async function closeDb() {
  await globalForDb.__kivmoSql?.end({ timeout: 5 });
  globalForDb.__kivmoSql = undefined;
  globalForDb.__kivmoDb = undefined;
}

export { schema };
