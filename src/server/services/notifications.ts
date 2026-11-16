import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { schema, type DB, type DBOrTx } from "@/db/client";

export const NOTIFICATION_KINDS: Record<string, string> = {
  station_favorite: "Stations favorites",
  baisse_prix: "Baisse de prix",
  disponibilite: "Retour de disponibilité",
  depart: "Départ prévu",
  budget: "Budget",
  consommation: "Consommation",
  amortissement: "Amortissement",
  projet: "Palier de projet",
  epargne: "Épargne et virements",
  rappel_epargne: "Rappel d'épargne",
  entretien: "Entretien",
  validation: "Validation des pleins",
};

/**
 * Notification dans l'application, avec dédoublonnage (clé), respect des préférences et
 * plafond quotidien (anti-spam). Le push navigateur n'est envoyé que s'il est connecté et permis.
 */
export async function notify(db: DBOrTx, userId: string, n: { kind: string; title: string; body: string; link?: string; dedupeKey: string }) {
  const [prefs] = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
  if (prefs && prefs.kinds[n.kind] === false) return null;
  if (prefs && !prefs.channels.inApp) return null;
  const critical = n.kind === "epargne" || n.kind === "validation";
  if (!critical) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.notifications).where(and(eq(schema.notifications.userId, userId), gte(schema.notifications.createdAt, new Date(Date.now() - 86_400_000))));
    if (count >= (prefs?.maxPerDay ?? 5)) return null;
  }
  const [row] = await db.insert(schema.notifications).values({ userId, ...n, link: n.link ?? null }).onConflictDoNothing().returning();
  return row ?? null;
}

export async function listNotifications(db: DBOrTx, userId: string) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).orderBy(desc(schema.notifications.createdAt)).limit(50);
}

export async function unreadCount(db: DBOrTx, userId: string) {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.notifications).where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return count;
}

export async function markAllRead(db: DB, userId: string) {
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
}

export async function updatePreferences(db: DB, userId: string, p: { kinds: Record<string, boolean>; channels: { inApp: boolean; push: boolean; email: boolean }; quietStart: string; quietEnd: string; maxPerDay: number }) {
  await db
    .insert(schema.notificationPreferences)
    .values({ userId, ...p })
    .onConflictDoUpdate({ target: schema.notificationPreferences.userId, set: { ...p, updatedAt: new Date() } });
}

export async function getPreferences(db: DBOrTx, userId: string) {
  const [p] = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
  return p ?? { userId, kinds: {}, channels: { inApp: true, push: false, email: false }, quietStart: "21:00", quietEnd: "08:00", maxPerDay: 5, updatedAt: new Date() };
}
