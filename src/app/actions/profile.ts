"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db/client";
import { requireSession, clearSessionCookie } from "@/server/session";
import { runAction, str, optStr } from "@/server/action";
import { AppError } from "@/server/errors";
import { audit } from "@/server/audit";
import { markAllRead, updatePreferences, NOTIFICATION_KINDS } from "@/server/services/notifications";
import { deleteAccount } from "@/server/services/exports";
import { SESSION_COOKIE, changePassword, destroySession } from "@/server/auth";

const ok = (msg: string) => `/profil?ok=${encodeURIComponent(msg)}`;

export async function updateProfileAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/profil", async () => {
    const db = getDb();
    const kind = str(fd, "accountKind");
    if (!["particulier", "independant", "entreprise"].includes(kind)) throw new AppError("VALIDATION", "Type de compte invalide.");
    await db.update(schema.users).set({ displayName: optStr(fd, "displayName"), accountKind: kind as "particulier", updatedAt: new Date() }).where(eq(schema.users.id, ctx.userId));
    const theme = ["system", "light", "dark"].includes(str(fd, "theme")) ? str(fd, "theme") : "system";
    await db.update(schema.profiles).set({ timeZone: str(fd, "timeZone") || "Europe/Paris", theme, preferredNavApp: str(fd, "preferredNavApp") || "google", deductConversionBeforeAllocation: str(fd, "deductConversion") === "1", updatedAt: new Date() }).where(eq(schema.profiles.userId, ctx.userId));
    await audit(db, { actorUserId: ctx.userId, action: "profile.update", resourceType: "user", resourceId: ctx.userId });
    revalidatePath("/", "layout");
    return ok("Profil enregistré.");
  });
}

export async function updateNotificationPrefsAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/profil", async () => {
    const kinds = Object.fromEntries(Object.keys(NOTIFICATION_KINDS).map((k) => [k, fd.get(`kind-${k}`) === "1"]));
    await updatePreferences(getDb(), ctx.userId, {
      kinds,
      channels: { inApp: true, push: fd.get("push") === "1", email: fd.get("email") === "1" },
      quietStart: str(fd, "quietStart") || "21:00",
      quietEnd: str(fd, "quietEnd") || "08:00",
      maxPerDay: Math.min(20, Math.max(1, Number(str(fd, "maxPerDay") || 5))),
    });
    return ok("Préférences de notification enregistrées.");
  });
}

export async function revokeConsentAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/profil", async () => {
    const db = getDb();
    await db.update(schema.consentRecords).set({ revokedAt: new Date() }).where(and(eq(schema.consentRecords.id, str(fd, "consentId")), eq(schema.consentRecords.userId, ctx.userId)));
    await audit(db, { actorUserId: ctx.userId, action: "consent.revoke", resourceType: "consent", resourceId: str(fd, "consentId") });
    return ok("Consentement retiré.");
  });
}

export async function createReferralAction() {
  const { ctx } = await requireSession();
  await runAction("/profil", async () => {
    const db = getDb();
    const [existing] = await db.select().from(schema.referralEvents).where(eq(schema.referralEvents.referrerUserId, ctx.userId));
    if (!existing) await db.insert(schema.referralEvents).values({ referrerUserId: ctx.userId, code: crypto.randomUUID().slice(0, 8).toUpperCase(), status: "code" });
    return ok("Code de parrainage prêt.");
  });
}

export async function markAllReadAction() {
  const { ctx } = await requireSession();
  await markAllRead(getDb(), ctx.userId);
  revalidatePath("/", "layout");
  redirect("/notifications");
}

export async function deleteAccountAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/profil", async () => {
    if (str(fd, "confirm") !== "SUPPRIMER") throw new AppError("VALIDATION", "Tapez SUPPRIMER pour confirmer.");
    const db = getDb();
    const jar = await cookies();
    const t = jar.get(SESSION_COOKIE)?.value;
    await deleteAccount(db, ctx);
    if (t) await destroySession(db, t).catch(() => undefined);
    await clearSessionCookie();
    return "/?ok=" + encodeURIComponent("Compte supprimé.");
  });
}

export async function changePasswordAction(fd: FormData) {
  const { ctx } = await requireSession();
  const next = String(fd.get("next") ?? "");
  if (next !== String(fd.get("confirm") ?? "")) redirect("/profil?erreur=" + encodeURIComponent("Les deux mots de passe ne sont pas identiques.") + "#mot-de-passe");
  await runAction("/profil", async () => {
    await changePassword(getDb(), ctx.userId, String(fd.get("current") ?? ""), next);
    return ok("Mot de passe enregistré.");
  });
}
