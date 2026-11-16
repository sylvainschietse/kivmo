import { api } from "@/server/api";
import { allocateAvailableGains, savingsOverview } from "@/server/services/savings";

export const GET = api(async ({ db, ctx }) => {
  const o = await savingsOverview(db, ctx);
  return { calculatedGains: o.gains.calculatedGains.toString(), netAfterConversion: o.gains.netAfterConversion.toString(), allocated: o.allocated.toString(), capacity: o.capacity.capacity.toString(), deficit: o.capacity.deficit.toString(), message: o.capacity.message };
});
export const POST = api(async ({ db, ctx }) => {
  const r = await allocateAvailableGains(db, ctx);
  return { lines: r.lines.map((l) => ({ projectId: l.projectId, amount: l.amount.toString() })), message: r.capacity.message };
});
