import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type DBOrTx } from "@/db/client";
import { D, Decimal, ZERO, toDb } from "@/lib/decimal";
import { analyzeConsumption, CALC_VERSION, type ConsumptionAnalysis } from "@/domain/consumption";
import { compareInterval, type ComparisonResult, type ReferenceProfileInput } from "@/domain/comparison";
import type { FillupInput, FuelCode } from "@/domain/types";

export interface VehicleData {
  fillups: (typeof schema.fillups.$inferSelect)[];
  lines: (typeof schema.fillupLines.$inferSelect)[];
  inputs: FillupInput[];
  profiles: ReferenceProfileInput[];
  analysis: ConsumptionAnalysis;
  comparisons: ComparisonResult[];
}

/** Compteur normalisé : relevé + Σ(ancien − nouveau) des remplacements antérieurs. */
export function normalizeOdometer(raw: Decimal, at: Date, events: { occurredAt: Date; oldReadingKm: string; newReadingKm: string }[]) {
  let offset = ZERO;
  for (const e of events) if (e.occurredAt.getTime() <= at.getTime()) offset = offset.plus(D(e.oldReadingKm).minus(e.newReadingKm));
  return raw.plus(offset);
}

export async function loadVehicleData(db: DBOrTx, vehicleId: string): Promise<VehicleData> {
  const [vehicle] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId));
  const fillups = await db
    .select()
    .from(schema.fillups)
    .where(and(eq(schema.fillups.vehicleId, vehicleId), isNull(schema.fillups.deletedAt)))
    .orderBy(asc(schema.fillups.occurredAt));
  const ids = fillups.map((f) => f.id);
  const lines = ids.length ? await db.select().from(schema.fillupLines).where(inArray(schema.fillupLines.fillupId, ids)) : [];
  const events = await db.select().from(schema.odometerEvents).where(eq(schema.odometerEvents.vehicleId, vehicleId));
  const profileRows = await db.select().from(schema.referenceProfiles).where(eq(schema.referenceProfiles.vehicleId, vehicleId));
  const profiles: ReferenceProfileInput[] = profileRows.map((p) => ({
    id: p.id,
    version: p.profileVersion,
    effectiveFrom: p.effectiveFrom,
    consumptionL100: D(p.consumptionL100),
    fuel: p.fuel as FuelCode,
    priceMode: p.priceMode as "fixed" | "observed",
    fixedPrice: p.fixedPrice ? D(p.fixedPrice) : null,
    label: p.label,
  }));
  const inputs: FillupInput[] = fillups.map((f) => ({
    id: f.id,
    occurredAt: f.occurredAt,
    odometerKm: normalizeOdometer(D(f.odometerKm), f.occurredAt, events),
    isFull: f.isFull,
    startsNewBaseline: f.startsNewBaseline,
    missedBefore: f.missedBefore,
    lines: lines.filter((l) => l.fillupId === f.id).map((l) => ({ fuel: l.fuel as FuelCode, liters: D(l.liters), amountPaid: D(l.amountPaid) })),
    referencePrice:
      f.refPrice && f.refPriceFuel
        ? { fuel: f.refPriceFuel as FuelCode, price: D(f.refPrice), source: f.refPriceSource ?? "inconnue", observedAt: f.refPriceObservedAt }
        : null,
  }));
  const analysis = analyzeConsumption(inputs, { tankCapacityL: vehicle?.tankCapacityL ? D(vehicle.tankCapacityL) : null });
  const byId = new Map(inputs.map((i) => [i.id, i]));
  const comparisons = analysis.intervals.map((i) => compareInterval(i, byId, profiles));
  return { fillups, lines, inputs, profiles, analysis, comparisons };
}

/**
 * Recalcul complet et reproductible d'un véhicule (intervalles + comparaisons), dans la
 * transaction de l'écriture. Les entrées d'épargne et virements ne sont jamais modifiés (cas G).
 */
export async function recomputeVehicle(tx: DBOrTx, vehicleId: string) {
  const data = await loadVehicleData(tx, vehicleId);
  await tx.delete(schema.consumptionIntervals).where(eq(schema.consumptionIntervals.vehicleId, vehicleId));
  await tx.delete(schema.comparisonResults).where(eq(schema.comparisonResults.vehicleId, vehicleId));
  if (data.analysis.intervals.length) {
    await tx.insert(schema.consumptionIntervals).values(
      data.analysis.intervals.map((i) => ({
        vehicleId,
        startFillupId: i.startFillupId,
        endFillupId: i.endFillupId,
        includedFillupIds: i.includedFillupIds,
        distanceKm: toDb(i.distanceKm, 1),
        volumeL: toDb(i.volumeL, 3),
        cost: toDb(i.cost, 4),
        consumptionL100: i.consumptionL100 ? toDb(i.consumptionL100, 4) : null,
        costPer100: i.costPer100 ? toDb(i.costPer100, 4) : null,
        status: i.status,
        issues: i.issues,
        closedAt: i.closedAt,
        calcVersion: CALC_VERSION,
      })),
    );
    await tx.insert(schema.comparisonResults).values(
      data.comparisons.map((c, idx) => ({
        vehicleId,
        intervalEndFillupId: c.intervalEndFillupId,
        profileId: c.profileId,
        profileVersion: c.profileVersion,
        status: c.status,
        basis: c.basis,
        referencePrice: c.referencePrice ? toDb(c.referencePrice, 4) : null,
        priceMethod: c.priceMethod,
        referenceCost: c.referenceCost ? toDb(c.referenceCost, 4) : null,
        actualCost: toDb(c.actualCost, 4),
        gain: c.gain ? toDb(c.gain, 4) : null,
        missingReason: c.missingReason,
        calcVersion: CALC_VERSION,
        closedAt: data.analysis.intervals[idx].closedAt,
      })),
    );
  }
  return data;
}
