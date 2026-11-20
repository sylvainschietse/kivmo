"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { requestMagicLink, destroySession, createSession, SESSION_COOKIE } from "@/server/auth";
import { AppError } from "@/server/errors";
import { clearSessionCookie, setSessionCookie, userAgent } from "@/server/session";
import { createDemoAccount } from "@/server/services/demo";
import { env } from "@/server/env";
import { checkRateLimit } from "@/server/rate-limit";

export async function requestLinkAction(fd: FormData) {
  const email = String(fd.get("email") ?? "");
  const next = String(fd.get("next") ?? "/accueil");
  try {
    await checkRateLimit(getDb(), `magic:${email.toLowerCase()}`, 5, 900);
    const { delivery, devLink } = await requestMagicLink(getDb(), email, next);
    // En ligne sans fournisseur d'email, rien n'est réellement envoyé : on le dit plutôt que d'annoncer un envoi.
    if (delivery === "console" && !devLink) throw new AppError("NOT_CONNECTED", "L'envoi des emails de connexion n'est pas encore branché. Utilisez le mode démonstration en attendant.");
    const q = new URLSearchParams({ envoye: "1", email });
    if (devLink) q.set("dev", devLink);
    redirect(`/connexion?${q}`);
  } catch (e) {
    if (e instanceof AppError) redirect(`/connexion?erreur=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

export async function startDemoAction() {
  if (!env.demoEnabled) redirect("/?erreur=" + encodeURIComponent("Mode démonstration désactivé."));
  const db = getDb();
  const ctx = await createDemoAccount(db);
  const token = await createSession(db, ctx.userId, await userAgent());
  await setSessionCookie(token);
  redirect("/accueil?demo=1");
}

export async function logoutAction() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await destroySession(getDb(), t);
  await clearSessionCookie();
  redirect("/");
}
