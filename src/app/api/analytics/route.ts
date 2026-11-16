import { api } from "@/server/api";
import { vehicleSummary } from "@/server/services/dashboard";
import { AppError } from "@/server/errors";

const s = (d: { toString(): string } | null | undefined) => (d == null ? null : d.toString());

export const GET = api(async ({ req, db, ctx }) => {
  const vehicleId = req.nextUrl.searchParams.get("vehicleId");
  if (!vehicleId) throw new AppError("VALIDATION", "vehicleId requis.");
  const v = await vehicleSummary(db, ctx, vehicleId);
  return {
    vehicleId,
    headline: v.headline,
    averageL100: s(v.averageL100),
    measuredGainTotal: s(v.measuredGainTotal),
    incompleteComparisons: v.incompleteComparisons,
    amortization: v.amortization && { cumulativeGain: s(v.amortization.cumulativeGain), netAfterConversion: s(v.amortization.netAfterConversion), remainingToAmortize: s(v.amortization.remainingToAmortize), initialAmortizedAt: v.amortization.initialAmortizedAt, currentlyAmortized: v.amortization.currentlyAmortized },
    monthly: v.monthly.map((m) => ({ month: m.month, spend: s(m.spend), liters: s(m.liters), consumptionL100: s(m.consumptionL100), measuredGain: s(m.measuredGain), incompleteComparisons: m.incompleteComparisons })),
    intervals: v.intervals.map((i) => ({ start: i.startFillupId, end: i.endFillupId, distanceKm: s(i.distanceKm), volumeL: s(i.volumeL), cost: s(i.cost), consumptionL100: s(i.consumptionL100), costPer100: s(i.costPer100), status: i.status, issues: i.issues, closedAt: i.closedAt, calcVersion: i.calcVersion })),
  };
});
