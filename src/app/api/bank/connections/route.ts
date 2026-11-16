import { api } from "@/server/api";
import { connectBank, listBankConnections } from "@/server/services/savings";
import { AppError } from "@/server/errors";

export const GET = api(async ({ db, ctx }) => listBankConnections(db, ctx));
export const POST = api(async ({ req, db, ctx }) => {
  const body = (await req.json()) as { consent?: boolean };
  if (!body.consent) throw new AppError("VALIDATION", "Consentement bancaire requis.");
  return Response.json(await connectBank(db, ctx, "banque-2026-11"), { status: 201 });
});
