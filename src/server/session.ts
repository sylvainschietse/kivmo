import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { resolveSession, SESSION_COOKIE, SESSION_DAYS } from "./auth";
import { env } from "./env";
import { checkRateLimit } from "./rate-limit";

export const getSession = cache(async () => {
  const jar = await cookies();
  return resolveSession(getDb(), jar.get(SESSION_COOKIE)?.value);
});

/** Session obligatoire : sinon redirection vers la connexion (session expirée gérée). */
export async function requireSession() {
  const s = await getSession();
  if (!s) {
    const jar = await cookies();
    redirect(jar.get(SESSION_COOKIE) ? "/connexion?expiree=1" : "/connexion");
  }
  return s;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function userAgent() {
  return (await headers()).get("user-agent");
}

/** Adresse IP du visiteur (Vercel renseigne x-forwarded-for), pour les limites anti-abus. */
export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64);
}

/** Limite par adresse IP (désactivable pour les tests automatiques, qui viennent tous de la même adresse). */
export async function checkIpRateLimit(prefix: string, max: number, windowSeconds: number) {
  if (process.env.IP_RATE_LIMIT === "off") return;
  const ip = await clientIp();
  if (ip) await checkRateLimit(getDb(), `${prefix}:${ip}`, max, windowSeconds);
}
