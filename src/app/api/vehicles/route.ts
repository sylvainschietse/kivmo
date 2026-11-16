import { api } from "@/server/api";
import { createVehicle, listVehicles } from "@/server/services/vehicles";

export const GET = api(async ({ req, db, ctx }) => listVehicles(db, ctx, { organizationId: req.nextUrl.searchParams.get("organizationId") ?? undefined, includeArchived: req.nextUrl.searchParams.get("archived") === "1" }));
export const POST = api(async ({ req, db, ctx }) => Response.json(await createVehicle(db, ctx, await req.json()), { status: 201 }));
