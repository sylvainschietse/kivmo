import { api, page } from "@/server/api";
import { createFillup, listFillups } from "@/server/services/fillups";
import type { FuelCode } from "@/domain/types";

export const GET = api(async ({ req, db, ctx }) => {
  const q = req.nextUrl.searchParams;
  return listFillups(db, ctx, {
    ...page(req),
    vehicleId: q.get("vehicleId") ?? undefined,
    organizationId: q.get("organizationId") ?? undefined,
    from: q.get("from") ? new Date(q.get("from")!) : undefined,
    to: q.get("to") ? new Date(q.get("to")!) : undefined,
    fuel: (q.get("fuel") as FuelCode) ?? undefined,
    usage: (q.get("usage") as "personnel") ?? undefined,
    driverUserId: q.get("driverUserId") ?? undefined,
    q: q.get("q") ?? undefined,
  });
});

/** Création idempotente : en-tête Idempotency-Key (identifiant stable côté client). */
export const POST = api(async ({ req, db, ctx }) => {
  const body = await req.json();
  const result = await createFillup(db, ctx, body, req.headers.get("idempotency-key"));
  return Response.json(result, { status: result.status === "created" ? 201 : 200 });
});
