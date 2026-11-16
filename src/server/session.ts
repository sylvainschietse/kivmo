import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { resolveSession, SESSION_COOKIE, SESSION_DAYS } from "./auth";
import { env } from "./env";

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
