import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { schema, type DBOrTx } from "@/db/client";
import { D, Decimal, sum, ZERO } from "@/lib/decimal";
import { averageConsumption, consumptionHeadline, type ConsumptionInterval } from "@/domain/consumption";
import { computeAmortization, type AmortizationResult, type ComparisonResult } from "@/domain/comparison";
import { monthlyAggregates, type MonthlyRow } from "@/domain/aggregates";
import type { Ctx } from "../authz";
import { loadVehicleData } from "./recompute";
import { projectFigures, savingsOverview } from "./savings";
import { requireVehicle } from "../authz";

export interface VehicleSummary {
  vehicle: typeof schema.vehicles.$inferSelect;
  headline: string;
  lastInterval: ConsumptionInterval | null;
  lastComparison: ComparisonResult | null;
  averageL100: Decimal | null;
  measuredGainTotal: Decimal;
  incompleteComparisons: number;
  amortization: AmortizationResult | null;
  conversion: typeof schema.conversions.$inferSelect | null;
  lastFillup: (typeof schema.fillups.$inferSelect & { liters: Decimal }) | null;
  fillupCount: number;
  monthly: MonthlyRow[];
  intervals: ConsumptionInterval[];
  comparisons: ComparisonResult[];
  hasReference: boolean;
  pendingCount: number;
}

export async function vehicleSummary(db: DBOrTx, ctx: Ctx, vehicleId: string, timeZone = "Europe/Paris"): Promise<VehicleSummary> {
  const { vehicle } = await requireVehicle(db, ctx, vehicleId, "read");
  const data = await loadVehicleData(db, vehicleId);
  const [conversion] = await db.select().from(schema.conversions).where(eq(schema.conversions.vehicleId, vehicleId));
  const amortization = conversion ? computeAmortization(data.analysis.intervals, data.comparisons, { cost: D(conversion.cost), date: new Date(conversion.date), odometerKm: D(conversion.odometerKm) }) : null;
  const last = data.fillups.at(-1) ?? null;
  const litersOf = (id: string) => sum(data.lines.filter((l) => l.fillupId === id).map((l) => D(l.liters)));
  const complete = data.comparisons.filter((c) => c.status === "complete" && c.gain);
  return {
    vehicle,
    headline: consumptionHeadline(data.analysis),
    lastInterval: data.analysis.intervals.at(-1) ?? null,
    lastComparison: data.comparisons.at(-1) ?? null,
    averageL100: averageConsumption(data.analysis.intervals),
    measuredGainTotal: sum(complete.map((c) => c.gain!)),
    incompleteComparisons: data.comparisons.length - complete.length,
    amortization,
    conversion: conversion ?? null,
    lastFillup: last ? { ...last, liters: litersOf(last.id) } : null,
    fillupCount: data.fillups.length,
    monthly: monthlyAggregates(
      data.fillups.map((f) => ({ occurredAt: f.occurredAt, total: D(f.totalPaid), liters: litersOf(f.id) })),
      data.analysis.intervals,
      data.comparisons,
      timeZone,
    ),
    intervals: data.analysis.intervals,
    comparisons: data.comparisons,
    hasReference: data.profiles.length > 0,
    pendingCount: data.analysis.pendingFillupIds.length,
  };
}

export async function homeData(db: DBOrTx, ctx: Ctx) {
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, ctx.userId));
  const vehicles = await db.select().from(schema.vehicles).where(and(eq(schema.vehicles.ownerUserId, ctx.userId), isNull(schema.vehicles.archivedAt)));
  const activeId = vehicles.find((v) => v.id === profile?.activeVehicleId)?.id ?? vehicles[0]?.id ?? null;
  const summary = activeId ? await vehicleSummary(db, ctx, activeId, profile?.timeZone) : null;
  const tz = profile?.timeZone ?? "Europe/Paris";
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthFillups = activeId ? await db.select().from(schema.fillups).where(and(eq(schema.fillups.vehicleId, activeId), isNull(schema.fillups.deletedAt), gte(schema.fillups.occurredAt, monthStart))) : [];
  const projects = await projectFigures(db, ctx);
  const primary = projects.find((p) => p.project.isPrimary) ?? projects[0] ?? null;
  const savings = await savingsOverview(db, ctx);
  const recentNotifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, ctx.userId)).orderBy(desc(schema.notifications.createdAt)).limit(3);
  return {
    profile,
    vehicles,
    summary,
    monthSpend: sum(monthFillups.map((f) => D(f.totalPaid))),
    monthFillupCount: monthFillups.length,
    primaryProject: primary,
    savings,
    timeZone: tz,
    recentNotifications,
    zero: ZERO,
  };
}
