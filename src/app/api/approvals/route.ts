import { api } from "@/server/api";
import { decideFillup } from "@/server/services/organizations";

export const POST = api(async ({ req, db, ctx }) => {
  const b = (await req.json()) as { fillupId: string; decision: "validated" | "rejected" | "to_complete"; reason?: string };
  await decideFillup(db, ctx, b.fillupId, b.decision, b.reason);
  return { ok: true };
});
