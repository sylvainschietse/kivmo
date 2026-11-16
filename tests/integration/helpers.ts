import { getDb, schema } from "@/db/client";
import type { Ctx } from "@/server/authz";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://kivmo:kivmo@localhost:5432/kivmo_test";
process.env.STORAGE_DIR = process.env.STORAGE_DIR ?? "/tmp/kivmo-test-storage";

export const db = () => getDb();

let n = 0;
export async function makeUser(label = "u", opts: { admin?: boolean } = {}): Promise<Ctx & { email: string }> {
  const email = `${label}-${Date.now()}-${n++}@test.invalid`;
  const [u] = await db().insert(schema.users).values({ email, isPlatformAdmin: opts.admin ?? false }).returning();
  await db().insert(schema.profiles).values({ userId: u.id });
  return { userId: u.id, isDemo: false, isPlatformAdmin: opts.admin ?? false, email };
}

export const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c === code) return e;
    throw new Error(`Code attendu ${code}, reçu ${c} : ${(e as Error).message}`);
  }
  throw new Error(`Code attendu ${code}, aucune erreur levée`);
}
