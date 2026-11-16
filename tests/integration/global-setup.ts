import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://kivmo:kivmo@localhost:5432/kivmo_test";

/** Base de test réinitialisée puis migrée à chaque exécution. */
export default async function setup() {
  const sql = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}
