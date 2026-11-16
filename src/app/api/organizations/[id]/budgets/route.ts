import { api } from "@/server/api";
import { listBudgets, upsertBudget } from "@/server/services/organizations";

export const GET = api<{ id: string }>(async ({ db, ctx, params }) => listBudgets(db, ctx, params.id));
export const POST = api<{ id: string }>(async ({ req, db, ctx, params }) => Response.json(await upsertBudget(db, ctx, params.id, await req.json()), { status: 201 }));
