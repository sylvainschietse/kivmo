"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { requestMagicLink, destroySession, createSession, loginWithPassword, signUpWithPassword, SESSION_COOKIE } from "@/server/auth";
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

function safeNext(raw: FormDataEntryValue | null) {
  const next = String(raw ?? "/accueil");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/accueil";
}

function backToLogin(mode: "connexion" | "creation", email: string, message: string, next: string) {
  const q = new URLSearchParams({ erreur: message, email });
  if (mode === "creation") q.set("mode", "creation");
  if (next !== "/accueil") q.set("next", next);
  redirect(`/connexion?${q}`);
}

export async function passwordLoginAction(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = safeNext(fd.get("next"));
  let target = next;
  try {
    await checkRateLimit(getDb(), `login:${email}`, 10, 900);
    const { user, sessionToken } = await loginWithPassword(getDb(), email, password, await userAgent());
    await setSessionCookie(sessionToken);
    if (!user.onboardedAt && !next.startsWith("/invitation")) target = "/onboarding";
  } catch (e) {
    if (e instanceof AppError) backToLogin("connexion", email, e.message, next);
    throw e;
  }
  redirect(target);
}

export async function passwordSignUpAction(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const next = safeNext(fd.get("next"));
  try {
    if (password !== confirm) throw new AppError("VALIDATION", "Les deux mots de passe ne sont pas identiques.");
    await checkRateLimit(getDb(), `signup:${email}`, 5, 900);
    const { sessionToken } = await signUpWithPassword(getDb(), email, password, await userAgent());
    await setSessionCookie(sessionToken);
  } catch (e) {
    if (e instanceof AppError) backToLogin("creation", email, e.message, next);
    throw e;
  }
  redirect(next.startsWith("/invitation") ? next : "/onboarding");
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
