import { api } from "@/server/api";
import { listPaymentOrders, preparePaymentOrder } from "@/server/services/savings";
import { AppError } from "@/server/errors";

export const GET = api(async ({ db, ctx }) => listPaymentOrders(db, ctx));
export const POST = api(async ({ req, db, ctx }) => {
  const key = req.headers.get("idempotency-key");
  if (!key) throw new AppError("VALIDATION", "En-tête Idempotency-Key requis.");
  const b = (await req.json()) as { projectId: string; amount: string; bankConnectionId: string };
  return preparePaymentOrder(db, ctx, { ...b, idempotencyKey: key });
});
