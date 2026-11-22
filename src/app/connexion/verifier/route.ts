import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { consumeMagicLink, safeNextPath, SESSION_COOKIE, SESSION_DAYS } from "@/server/auth";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  try {
    const { sessionToken, user, isNew } = await consumeMagicLink(getDb(), token, req.headers.get("user-agent"));
    const res = NextResponse.redirect(new URL((isNew || !user.onboardedAt) && !next.startsWith("/invitation") ? "/onboarding" : next, req.url));
    res.cookies.set(SESSION_COOKIE, sessionToken, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
    return res;
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Connexion impossible.";
    return NextResponse.redirect(new URL(`/connexion?erreur=${encodeURIComponent(msg)}`, req.url));
  }
}
