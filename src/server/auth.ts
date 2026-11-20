import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type DB } from "@/db/client";
import { AppError } from "./errors";
import type { Ctx } from "./authz";
import { sendEmail } from "@/integrations/email";
import { env } from "./env";
import { audit } from "./audit";

export const SESSION_COOKIE = "kivmo_session";
export const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 15;

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

export function hmac(value: string, secret = env.sessionSecret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Envoie un lien de connexion. Ne révèle pas si l'adresse possède déjà un compte. */
export async function requestMagicLink(db: DB, rawEmail: string, nextPath = "/accueil") {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AppError("VALIDATION", "Adresse email invalide.");
  const token = randomToken();
  await db.insert(schema.authTokens).values({
    email,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + MAGIC_LINK_MINUTES * 60_000),
  });
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/accueil";
  const link = `${env.appUrl}/connexion/verifier?token=${encodeURIComponent(token)}&next=${encodeURIComponent(safeNext)}`;
  const delivery = await sendEmail({
    to: email,
    subject: "Votre lien de connexion KIVMO",
    text: `Bonjour,\n\nVoici votre lien de connexion KIVMO, valable ${MAGIC_LINK_MINUTES} minutes :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
  });
  // Le lien n'est affiché à l'écran qu'en développement (ou en test explicite) : en ligne,
  // l'afficher permettrait d'entrer dans le compte de n'importe qui.
  const showOnScreen = delivery === "console" && (process.env.NODE_ENV !== "production" || process.env.AUTH_LINK_ON_SCREEN === "on");
  return { delivery, devLink: showOnScreen ? link : null };
}

/** Consomme un lien (usage unique) et ouvre une session. */
export async function consumeMagicLink(db: DB, token: string, userAgent?: string | null) {
  const hash = sha256(token);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.authTokens.tokenHash, hash), isNull(schema.authTokens.usedAt), gt(schema.authTokens.expiresAt, new Date())))
      .returning();
    if (!row) throw new AppError("SESSION_EXPIRED", "Lien expiré ou déjà utilisé. Demandez un nouveau lien.");
    let [user] = await tx.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${row.email}`);
    let isNew = false;
    if (!user) {
      [user] = await tx.insert(schema.users).values({ email: row.email }).returning();
      await tx.insert(schema.profiles).values({ userId: user.id });
      await tx.insert(schema.notificationPreferences).values({ userId: user.id });
      isNew = true;
    }
    if (user.deletedAt) throw new AppError("FORBIDDEN", "Ce compte a été supprimé.");
    const sessionToken = await createSession(tx as unknown as DB, user.id, userAgent);
    await audit(tx, { actorUserId: user.id, action: "auth.login", resourceType: "user", resourceId: user.id });
    return { user, sessionToken, isNew };
  });
}

export async function createSession(db: DB, userId: string, userAgent?: string | null) {
  const token = randomToken();
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    userAgent: userAgent?.slice(0, 200) ?? null,
  });
  return token;
}

export async function resolveSession(db: DB, token: string | undefined | null): Promise<{ ctx: Ctx; user: typeof schema.users.$inferSelect } | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, sha256(token)));
  const r = rows[0];
  if (!r || r.session.expiresAt < new Date() || r.user.deletedAt) return null;
  return { ctx: { userId: r.user.id, isDemo: r.user.isDemo, isPlatformAdmin: r.user.isPlatformAdmin }, user: r.user };
}

export async function destroySession(db: DB, token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
}

/** URL temporaire signée pour une pièce jointe. L'autorisation est revérifiée à la lecture. */
export function signAttachmentUrl(attachmentId: string, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(`${attachmentId}.${exp}`);
  return `/api/attachments/${attachmentId}?exp=${exp}&sig=${sig}`;
}

export function verifyAttachmentSignature(attachmentId: string, exp: string | null, sig: string | null) {
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(hmac(`${attachmentId}.${exp}`), sig);
}
