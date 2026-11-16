import { api } from "@/server/api";
import { vehicleSummary } from "@/server/services/dashboard";
import { AppError } from "@/server/errors";

export const GET = api(async ({ req, db, ctx }) => {
  const vehicleId = req.nextUrl.searchParams.get("vehicleId");
  if (!vehicleId) throw new AppError("VALIDATION", "vehicleId requis.");
  const v = await vehicleSummary(db, ctx, vehicleId);
  return v.comparisons.map((c) => ({ ...c, referencePrice: c.referencePrice?.toString() ?? null, referenceCost: c.referenceCost?.toString() ?? null, actualCost: c.actualCost.toString(), gain: c.gain?.toString() ?? null }));
});
