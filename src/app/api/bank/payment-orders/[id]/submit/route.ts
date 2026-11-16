import { api } from "@/server/api";
import { submitPaymentOrder } from "@/server/services/savings";

export const POST = api<{ id: string }>(async ({ req, db, ctx, params }) => {
  const b = (await req.json()) as { consent: boolean };
  return submitPaymentOrder(db, ctx, params.id, { consent: b.consent === true });
});
