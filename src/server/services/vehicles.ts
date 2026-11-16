import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { D } from "@/lib/decimal";
import { FUELS } from "@/domain/types";
import { AppError, validation } from "../errors";
import { requireOrgRole, requireVehicle, membershipOf, type Ctx } from "../authz";
import { audit } from "../audit";
import { recomputeVehicle } from "./recompute";

const decStr = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").replace(/\s/g, ""))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), "Nombre invalide");

export const vehicleInput = z.object({
  name: z.string().trim().min(1, "Nom requis").max(80),
  make: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  year: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  engine: z.string().trim().max(80).optional().nullable(),
  energy: z.enum(["essence", "diesel", "e85_flex", "e85_conversion", "gpl", "hybride", "hybride_rechargeable", "electrique"]),
  tankCapacityL: decStr.optional().nullable(),
  initialOdometerKm: decStr.optional().nullable(),
  currency: z.string().length(3).default("EUR"),
  country: z.string().length(2).default("FR"),
  plate: z.string().trim().max(20).optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
});
export type VehicleInput = z.input<typeof vehicleInput>;

export async function listVehicles(db: DBOrTx, ctx: Ctx, opts: { includeArchived?: boolean; organizationId?: string } = {}) {
  if (opts.organizationId) {
    const m = await requireOrgRole(db, ctx, opts.organizationId, "read");
    const rows = await db.select().from(schema.vehicles).where(eq(schema.vehicles.organizationId, opts.organizationId)).orderBy(asc(schema.vehicles.name));
    let visible = rows;
    if (m.role === "driver") {
      const assigned = await db.select({ v: schema.vehicleAssignments.vehicleId }).from(schema.vehicleAssignments).where(eq(schema.vehicleAssignments.userId, ctx.userId));
      const ids = new Set(assigned.map((a) => a.v));
      visible = rows.filter((r) => ids.has(r.id));
    } else if (m.role === "manager" && m.teamId) visible = rows.filter((r) => r.teamId === m.teamId);
    return visible.filter((v) => opts.includeArchived || !v.archivedAt);
  }
  const rows = await db
    .select()
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.ownerUserId, ctx.userId), opts.includeArchived ? undefined : isNull(schema.vehicles.archivedAt)))
    .orderBy(asc(schema.vehicles.createdAt));
  return rows;
}

export async function createVehicle(db: DB, ctx: Ctx, raw: VehicleInput) {
  const parsed = vehicleInput.safeParse(raw);
  if (!parsed.success) throw validation("Véhicule invalide.", parsed.error.flatten());
  const v = parsed.data;
  if (v.organizationId) await requireOrgRole(db, ctx, v.organizationId, "admin");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.vehicles)
      .values({
        ownerUserId: v.organizationId ? null : ctx.userId,
        organizationId: v.organizationId ?? null,
        teamId: v.teamId ?? null,
        name: v.name,
        make: v.make ?? null,
        model: v.model ?? null,
        year: v.year ?? null,
        engine: v.engine ?? null,
        energy: v.energy,
        tankCapacityL: v.tankCapacityL ?? null,
        initialOdometerKm: v.initialOdometerKm ?? "0",
        currency: v.currency,
        country: v.country,
        plate: v.plate ?? null,
      })
      .returning();
    if (!v.organizationId) {
      const [p] = await tx.select().from(schema.profiles).where(eq(schema.profiles.userId, ctx.userId));
      if (p && !p.activeVehicleId) await tx.update(schema.profiles).set({ activeVehicleId: row.id }).where(eq(schema.profiles.userId, ctx.userId));
    }
    await audit(tx, { actorUserId: ctx.userId, organizationId: v.organizationId, action: "vehicle.create", resourceType: "vehicle", resourceId: row.id });
    return row;
  });
}

export async function updateVehicle(db: DB, ctx: Ctx, vehicleId: string, raw: Partial<VehicleInput>, expectedVersion: number) {
  const { vehicle } = await requireVehicle(db, ctx, vehicleId, "write");
  const parsed = vehicleInput.partial().safeParse(raw);
  if (!parsed.success) throw validation("Véhicule invalide.", parsed.error.flatten());
  const { organizationId: _o, initialOdometerKm, ...rest } = parsed.data;
  void _o;
  const patch = { ...rest, ...(initialOdometerKm ? { initialOdometerKm } : {}) };
  const [row] = await db
    .update(schema.vehicles)
    .set({ ...patch, updatedAt: new Date(), version: vehicle.version + 1 })
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.version, expectedVersion)))
    .returning();
  if (!row) throw new AppError("VERSION_CONFLICT", "Ce véhicule a été modifié entre-temps. Rechargez la page pour voir la dernière version.");
  if (patch.tankCapacityL !== undefined) await db.transaction((tx) => recomputeVehicle(tx, vehicleId));
  await audit(db, { actorUserId: ctx.userId, organizationId: vehicle.organizationId, action: "vehicle.update", resourceType: "vehicle", resourceId: vehicleId, details: { fields: Object.keys(patch) } });
  return row;
}

export async function archiveVehicle(db: DB, ctx: Ctx, vehicleId: string, archived: boolean) {
  const { vehicle } = await requireVehicle(db, ctx, vehicleId, "write");
  await db.update(schema.vehicles).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(schema.vehicles.id, vehicleId));
  await audit(db, { actorUserId: ctx.userId, organizationId: vehicle.organizationId, action: archived ? "vehicle.archive" : "vehicle.unarchive", resourceType: "vehicle", resourceId: vehicleId });
}

export async function setActiveVehicle(db: DB, ctx: Ctx, vehicleId: string) {
  await requireVehicle(db, ctx, vehicleId, "read");
  await db.update(schema.profiles).set({ activeVehicleId: vehicleId, updatedAt: new Date() }).where(eq(schema.profiles.userId, ctx.userId));
}

/* ── Profil de comparaison : versions historisées, jamais réécrites ── */

export const referenceInput = z.object({
  kind: z.enum(["ancien_vehicule", "meme_vehicule_autre_carburant", "scenario_libre"]),
  label: z.string().trim().min(1).max(120),
  fuel: z.enum(FUELS),
  consumptionL100: decStr,
  priceMode: z.enum(["fixed", "observed"]),
  fixedPrice: decStr.optional().nullable(),
  effectiveFrom: z.coerce.date(),
  method: z.string().max(300).optional().nullable(),
  confidence: z.enum(["faible", "moyenne", "elevee"]).default("moyenne"),
});

export async function addReferenceProfile(db: DB, ctx: Ctx, vehicleId: string, raw: z.input<typeof referenceInput>) {
  await requireVehicle(db, ctx, vehicleId, "write");
  const parsed = referenceInput.safeParse(raw);
  if (!parsed.success) throw validation("Référence invalide.", parsed.error.flatten());
  const r = parsed.data;
  if (D(r.consumptionL100).lte(0)) throw validation("La consommation de référence doit être positive.");
  if (r.priceMode === "fixed" && !r.fixedPrice) throw validation("Indiquez le prix fixe du scénario.");
  return db.transaction(async (tx) => {
    const [{ v }] = await tx.select({ v: max(schema.referenceProfiles.profileVersion) }).from(schema.referenceProfiles).where(eq(schema.referenceProfiles.vehicleId, vehicleId));
    const [row] = await tx
      .insert(schema.referenceProfiles)
      .values({ vehicleId, profileVersion: (v ?? 0) + 1, kind: r.kind, label: r.label, fuel: r.fuel, consumptionL100: r.consumptionL100, priceMode: r.priceMode, fixedPrice: r.fixedPrice ?? null, effectiveFrom: r.effectiveFrom, method: r.method ?? null, confidence: r.confidence })
      .returning();
    await recomputeVehicle(tx, vehicleId);
    await audit(tx, { actorUserId: ctx.userId, action: "reference.version", resourceType: "vehicle", resourceId: vehicleId, details: { version: row.profileVersion } });
    return row;
  });
}

export async function listReferenceProfiles(db: DBOrTx, ctx: Ctx, vehicleId: string) {
  await requireVehicle(db, ctx, vehicleId, "read");
  return db.select().from(schema.referenceProfiles).where(eq(schema.referenceProfiles.vehicleId, vehicleId)).orderBy(desc(schema.referenceProfiles.profileVersion));
}

/* ── Conversion déclarée ── */

export const conversionInput = z.object({
  declaredType: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  odometerKm: decStr,
  cost: decStr,
  provider: z.string().trim().max(120).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});

export async function setConversion(db: DB, ctx: Ctx, vehicleId: string, raw: z.input<typeof conversionInput>) {
  await requireVehicle(db, ctx, vehicleId, "write");
  const parsed = conversionInput.safeParse(raw);
  if (!parsed.success) throw validation("Conversion invalide.", parsed.error.flatten());
  const c = parsed.data;
  if (D(c.cost).lt(0)) throw validation("Le coût ne peut pas être négatif.");
  const [existing] = await db.select().from(schema.conversions).where(eq(schema.conversions.vehicleId, vehicleId));
  if (existing) {
    await db.update(schema.conversions).set({ ...c, provider: c.provider ?? null, note: c.note ?? null, updatedAt: new Date(), version: existing.version + 1 }).where(eq(schema.conversions.id, existing.id));
  } else {
    await db.insert(schema.conversions).values({ vehicleId, ...c, provider: c.provider ?? null, note: c.note ?? null });
  }
  await audit(db, { actorUserId: ctx.userId, action: "conversion.set", resourceType: "vehicle", resourceId: vehicleId, details: { cost: c.cost, date: c.date } });
}

export async function getConversion(db: DBOrTx, vehicleId: string) {
  const [c] = await db.select().from(schema.conversions).where(eq(schema.conversions.vehicleId, vehicleId));
  return c ?? null;
}

/* ── Compteur remplacé : décalage historisé ── */

export async function declareOdometerReplacement(db: DB, ctx: Ctx, vehicleId: string, input: { occurredAt: Date; oldReadingKm: string; newReadingKm: string; note?: string }) {
  await requireVehicle(db, ctx, vehicleId, "write");
  return db.transaction(async (tx) => {
    await tx.insert(schema.odometerEvents).values({ vehicleId, occurredAt: input.occurredAt, oldReadingKm: input.oldReadingKm, newReadingKm: input.newReadingKm, note: input.note ?? null, createdBy: ctx.userId });
    await recomputeVehicle(tx, vehicleId);
    await audit(tx, { actorUserId: ctx.userId, action: "odometer.replacement", resourceType: "vehicle", resourceId: vehicleId, details: { old: input.oldReadingKm, new: input.newReadingKm } });
  });
}

/* ── Affectations (entreprise) ── */

export async function assignVehicle(db: DB, ctx: Ctx, vehicleId: string, input: { userId: string; startsAt: Date; startOdometerKm?: string | null }) {
  const { vehicle } = await requireVehicle(db, ctx, vehicleId, "write");
  if (!vehicle.organizationId) throw validation("Les affectations concernent les véhicules d'organisation.");
  const target = await membershipOf(db, { userId: input.userId, isDemo: false, isPlatformAdmin: false }, vehicle.organizationId);
  if (!target) throw validation("Ce conducteur n'est pas membre de l'organisation.");
  const [row] = await db.insert(schema.vehicleAssignments).values({ vehicleId, userId: input.userId, organizationId: vehicle.organizationId, startsAt: input.startsAt, startOdometerKm: input.startOdometerKm ?? null }).returning();
  await audit(db, { actorUserId: ctx.userId, organizationId: vehicle.organizationId, action: "assignment.create", resourceType: "vehicle", resourceId: vehicleId, details: { driver: input.userId } });
  return row;
}

export async function endAssignment(db: DB, ctx: Ctx, assignmentId: string, input: { endsAt: Date; endOdometerKm?: string | null }) {
  const [a] = await db.select().from(schema.vehicleAssignments).where(eq(schema.vehicleAssignments.id, assignmentId));
  if (!a) throw new AppError("NOT_FOUND", "Affectation introuvable.");
  await requireVehicle(db, ctx, a.vehicleId, "write");
  await db.update(schema.vehicleAssignments).set({ endsAt: input.endsAt, endOdometerKm: input.endOdometerKm ?? null, updatedAt: new Date() }).where(eq(schema.vehicleAssignments.id, assignmentId));
}

export async function vehiclesByIds(db: DBOrTx, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(schema.vehicles).where(inArray(schema.vehicles.id, ids));
}
