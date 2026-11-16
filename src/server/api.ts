import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type DB } from "@/db/client";
import { resolveSession, SESSION_COOKIE } from "./auth";
import { AppError } from "./errors";
import type { Ctx } from "./authz";
import { checkRateLimit } from "./rate-limit";

type Handler<P> = (args: { req: NextRequest; db: DB; ctx: Ctx; params: P }) => Promise<Response | unknown>;

/** Protection CSRF : les écritures par cookie exigent une origine identique. */
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return json(e.toJSON(), e.status);
  console.error("[api] erreur inattendue", e);
  return json({ error: { code: "INTERNAL", message: "Erreur interne. Réessayez sans risque de doublon : les écritures sont idempotentes.", details: null } }, 500);
}

/** Route API authentifiée : session, CSRF, limitation de débit, erreurs structurées. */
export function api<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      const db = getDb();
      const s = await resolveSession(db, req.cookies.get(SESSION_COOKIE)?.value);
      if (!s) throw new AppError(req.cookies.get(SESSION_COOKIE) ? "SESSION_EXPIRED" : "UNAUTHENTICATED", "Connexion requise.");
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (!sameOrigin(req)) throw new AppError("FORBIDDEN", "Origine de la requête refusée.");
        await checkRateLimit(db, `api:${s.ctx.userId}`, 120, 60);
      }
      const out = await handler({ req, db, ctx: s.ctx, params: await context.params });
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function page(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0, 0);
  return { limit, offset };
}

/** Tâches planifiées : jeton partagé obligatoire. */
export function cron(handler: (db: DB, req: NextRequest) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: { code: "FORBIDDEN", message: "Jeton de tâche invalide." } }, 403);
    try {
      return json(await handler(getDb(), req));
    } catch (e) {
      return errorResponse(e);
    }
  };
}
