import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
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

/** L'envoi de liens par email est-il réellement possible ici ? */
export function magicLinkAvailable() {
  if (env.emailProvider === "smtp") return Boolean(process.env.SMTP_URL);
  if (env.emailProvider === "console") return process.env.NODE_ENV !== "production" || process.env.AUTH_LINK_ON_SCREEN === "on";
  return false;
}

// Mot de passe : scrypt avec sel aléatoire, format « scrypt$N$sel$empreinte ».
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const PASSWORD_MIN = 10;
const DUMMY_HASH = "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAA";

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const [algo, n, salt, hash] = (stored ?? "").split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, "base64url"), 64, { ...SCRYPT, N: Number(n) });
  return safeEqual(key.toString("base64url"), hash);
}

function checkPasswordStrength(password: string, email: string) {
  if (password.length < PASSWORD_MIN) throw new AppError("VALIDATION", `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`);
  if (password.length > 200) throw new AppError("VALIDATION", "Mot de passe trop long.");
  if (password.toLowerCase() === email) throw new AppError("VALIDATION", "Le mot de passe ne peut pas être votre adresse email.");
}

async function newUser(tx: DB, email: string, passwordHash: string | null) {
  const [user] = await tx.insert(schema.users).values({ email, passwordHash }).returning();
  await tx.insert(schema.profiles).values({ userId: user.id });
  await tx.insert(schema.notificationPreferences).values({ userId: user.id });
  return user;
}

/** Crée un compte avec mot de passe et ouvre une session. */
export async function signUpWithPassword(db: DB, rawEmail: string, password: string, userAgent?: string | null) {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AppError("VALIDATION", "Adresse email invalide.");
  checkPasswordStrength(password, email);
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
    if (existing) throw new AppError("CONFLICT", "Un compte existe déjà avec cette adresse. Connectez-vous.");
    const user = await newUser(tx as unknown as DB, email, passwordHash);
    const sessionToken = await createSession(tx as unknown as DB, user.id, userAgent);
    await audit(tx, { actorUserId: user.id, action: "auth.signup", resourceType: "user", resourceId: user.id });
    return { user, sessionToken };
  });
}

/** Connexion par mot de passe. Même message que l'adresse existe ou non. */
export async function loginWithPassword(db: DB, rawEmail: string, password: string, userAgent?: string | null) {
  const email = rawEmail.trim().toLowerCase();
  const [user] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
  // Le calcul est fait même sans compte, pour ne pas révéler par le temps de réponse si l'adresse existe.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.isDemo) throw new AppError("VALIDATION", "Adresse email ou mot de passe incorrect.");
  if (user.deletedAt) throw new AppError("FORBIDDEN", "Ce compte a été supprimé.");
  const sessionToken = await createSession(db, user.id, userAgent);
  await audit(db, { actorUserId: user.id, action: "auth.login", resourceType: "user", resourceId: user.id });
  return { user, sessionToken };
}

/** Définit ou change le mot de passe : l'ancien est exigé s'il existe. */
export async function changePassword(db: DB, userId: string, current: string, next: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.isDemo) throw new AppError("FORBIDDEN", "Indisponible pour un compte de démonstration.");
  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) throw new AppError("VALIDATION", "Mot de passe actuel incorrect.");
  checkPasswordStrength(next, user.email.toLowerCase());
  await db.update(schema.users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(schema.users.id, userId));
  await audit(db, { actorUserId: userId, action: "auth.password_changed", resourceType: "user", resourceId: userId });
}

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
      user = await newUser(tx as unknown as DB, row.email, null);
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
