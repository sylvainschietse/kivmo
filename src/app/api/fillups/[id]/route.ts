import { api } from "@/server/api";
import { deleteFillup, getFillup, updateFillup } from "@/server/services/fillups";
import { AppError } from "@/server/errors";

export const GET = api<{ id: string }>(async ({ db, ctx, params }) => getFillup(db, ctx, params.id));

/** Correction : en-tête If-Match obligatoire (version) — verrou optimiste. */
export const PATCH = api<{ id: string }>(async ({ req, db, ctx, params }) => {
  const version = Number(req.headers.get("if-match"));
  if (!Number.isInteger(version)) throw new AppError("VALIDATION", "En-tête If-Match (version) requis.");
  const body = await req.json();
  return updateFillup(db, ctx, params.id, body, version, { closedPeriodCorrection: Boolean(body.closedPeriodCorrection) });
});

export const DELETE = api<{ id: string }>(async ({ req, db, ctx, params }) => {
  const reason = req.nextUrl.searchParams.get("reason") ?? "Suppression via API";
  await deleteFillup(db, ctx, params.id, reason);
  return { deleted: true };
});
