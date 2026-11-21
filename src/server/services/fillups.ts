import { and, desc, eq, gte, isNull, lte, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { D, Decimal, parseDecimalFr, sum, toDb } from "@/lib/decimal";
import { FUELS, type FuelCode } from "@/domain/types";
import { resolveAmounts, validateFillup, isProbableDuplicate, type ValidationIssue } from "@/domain/fillup-entry";
import { AppError, validation } from "../errors";
import { requireFillup, requireVehicle, type Ctx } from "../authz";
import { audit } from "../audit";
import { recomputeVehicle, normalizeOdometer } from "./recompute";
import { assertPeriodOpen, isInClosedPeriod } from "./periods";

const optDec = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v === null || v === undefined || v === "" ? null : parseDecimalFr(String(v))));

export const fillupLineInput = z.object({
  fuel: z.enum(FUELS),
  liters: optDec,
  unitPrice: optDec,
  amount: optDec,
  discount: optDec,
});

export const fillupInput = z.object({
  vehicleId: z.string().uuid(),
  occurredAt: z.coerce.date(),
  odometerKm: z.union([z.string(), z.number()]).transform((v) => parseDecimalFr(String(v))),
  isFull: z.boolean(),
  stationId: z.string().uuid().optional().nullable(),
  stationLabel: z.string().max(200).optional().nullable(),
  lines: z.array(fillupLineInput).min(1).max(5),
  usage: z.enum(["personnel", "professionnel", "mixte"]).default("personnel"),
  category: z.string().max(60).optional().nullable(),
  receiptAttachmentId: z.string().uuid().optional().nullable(),
  odometerAttachmentId: z.string().uuid().optional().nullable(),
  startsNewBaseline: z.boolean().default(false),
  missedBefore: z.boolean().default(false),
  referencePrice: optDec,
  confirmIssues: z.boolean().default(false),
  confirmNote: z.string().max(500).optional().nullable(),
  confirmDuplicate: z.boolean().default(false),
  driverUserId: z.string().uuid().optional().nullable(),
  reimbursable: z.boolean().default(false),
  accountingFields: z.record(z.string(), z.string().max(120)).default({}),
  source: z.enum(["manual", "ocr", "dictation", "import", "offline_sync", "demo"]).default("manual"),
});
export type FillupInputRaw = z.input<typeof fillupInput>;

export type FillupWriteResult =
  | { status: "created" | "existing" | "updated"; fillup: typeof schema.fillups.$inferSelect }
  | { status: "needs_confirmation"; issues: ValidationIssue[]; duplicateOf?: string | null }
  | { status: "amount_mismatch"; lineIndex: number; message: string; candidates: Record<string, string> };

interface ResolvedLine {
  fuel: FuelCode;
  liters: Decimal;
  unitPrice: Decimal;
  amount: Decimal;
  discount: Decimal;
}

function resolveLines(lines: z.output<typeof fillupLineInput>[]): ResolvedLine[] | { lineIndex: number; message: string; candidates: Record<string, string> } {
  const out: ResolvedLine[] = [];
  for (const [i, l] of lines.entries()) {
    const r = resolveAmounts({ liters: l.liters, unitPrice: l.unitPrice, total: l.amount, discount: l.discount });
    if (!r.ok) {
      if (r.error === "MISMATCH")
        return { lineIndex: i, message: r.message, candidates: Object.fromEntries(Object.entries(r.candidates).map(([k, v]) => [k, v.toDecimalPlaces(3).toString()])) };
      throw validation(r.message, { lineIndex: i });
    }
    out.push({ fuel: l.fuel, liters: r.liters, unitPrice: r.unitPrice, amount: r.total, discount: r.discount });
  }
  return out;
}

/**
 * Pleins voisins dans l'ordre chronologique. À horodatage égal (deux saisies dans la même minute),
 * l'ordre est départagé par le compteur, comme dans le recalcul.
 */
async function neighbours(db: DBOrTx, vehicleId: string, at: Date, odometerKm: string, excludeId?: string) {
  const base = and(eq(schema.fillups.vehicleId, vehicleId), isNull(schema.fillups.deletedAt), excludeId ? sql`${schema.fillups.id} <> ${excludeId}` : undefined);
  const f = schema.fillups;
  const ts = at.toISOString();
  const [previous] = await db.select().from(f).where(and(base, sql`(${f.occurredAt} < ${ts}::timestamptz or (${f.occurredAt} = ${ts}::timestamptz and ${f.odometerKm} <= ${odometerKm}::numeric))`)).orderBy(desc(f.occurredAt), desc(f.odometerKm)).limit(1);
  const [next] = await db.select().from(f).where(and(base, sql`(${f.occurredAt} > ${ts}::timestamptz or (${f.occurredAt} = ${ts}::timestamptz and ${f.odometerKm} > ${odometerKm}::numeric))`)).orderBy(f.occurredAt, f.odometerKm).limit(1);
  return { previous: previous ?? null, next: next ?? null };
}

/** Instantané du prix de référence : prix daté de la station pour le carburant de référence, sinon saisie, sinon rien. */
async function referenceSnapshot(db: DBOrTx, vehicleId: string, at: Date, stationId: string | null | undefined, manual: Decimal | null) {
  const [profile] = await db
    .select()
    .from(schema.referenceProfiles)
    .where(and(eq(schema.referenceProfiles.vehicleId, vehicleId), lte(schema.referenceProfiles.effectiveFrom, at)))
    .orderBy(desc(schema.referenceProfiles.effectiveFrom), desc(schema.referenceProfiles.profileVersion))
    .limit(1);
  if (!profile) return null;
  if (manual) return { fuel: profile.fuel, price: manual, source: "saisie utilisateur", observedAt: at };
  if (stationId) {
    const [obs] = await db
      .select()
      .from(schema.priceObservations)
      .where(and(eq(schema.priceObservations.stationId, stationId), eq(schema.priceObservations.fuel, profile.fuel), lte(schema.priceObservations.observedAt, at), gte(schema.priceObservations.observedAt, new Date(at.getTime() - 7 * 86_400_000))))
      .orderBy(desc(schema.priceObservations.observedAt))
      .limit(1);
    if (obs) return { fuel: profile.fuel, price: D(obs.price), source: `station:${obs.source}`, observedAt: obs.observedAt };
  }
  return null;
}

function localDate(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function createFillup(db: DB, ctx: Ctx, raw: FillupInputRaw, idempotencyKey: string | null): Promise<FillupWriteResult> {
  const parsed = fillupInput.safeParse(raw);
  if (!parsed.success) throw validation("Plein invalide.", parsed.error.flatten());
  const input = parsed.data;
  if (!input.odometerKm) throw validation("Compteur invalide.");

  // Rejeu avec la même clé : on renvoie le plein existant sans doublon.
  if (idempotencyKey) {
    const [existing] = await db.select().from(schema.fillups).where(and(eq(schema.fillups.createdBy, ctx.userId), eq(schema.fillups.idempotencyKey, idempotencyKey)));
    if (existing) return { status: "existing", fillup: existing };
  }

  const access = await requireVehicle(db, ctx, input.vehicleId, "add_fillup");
  const vehicle = access.vehicle;
  if (vehicle.archivedAt) throw validation("Ce véhicule est archivé.");
  if (vehicle.organizationId) await assertPeriodOpen(db, vehicle.organizationId, input.occurredAt);

  const lines = resolveLines(input.lines);
  if (!Array.isArray(lines)) return { status: "amount_mismatch", ...lines };
  const liters = sum(lines.map((l) => l.liters));
  const total = sum(lines.map((l) => l.amount));

  const events = await db.select().from(schema.odometerEvents).where(eq(schema.odometerEvents.vehicleId, vehicle.id));
  const norm = (raw: string | Decimal, at: Date) => normalizeOdometer(D(raw), at, events);
  const { previous, next } = await neighbours(db, vehicle.id, input.occurredAt, String(input.odometerKm));
  const issues = validateFillup({
    occurredAt: input.occurredAt,
    odometerKm: norm(input.odometerKm, input.occurredAt),
    liters,
    tankCapacityL: vehicle.tankCapacityL ? D(vehicle.tankCapacityL) : null,
    previous: previous ? { occurredAt: previous.occurredAt, odometerKm: norm(previous.odometerKm, previous.occurredAt) } : null,
    next: next ? { occurredAt: next.occurredAt, odometerKm: norm(next.odometerKm, next.occurredAt) } : null,
  });
  const blocking = issues.filter((i) => i.level === "blocking");
  if (blocking.length) throw validation(blocking.map((b) => b.message).join(" "), { issues: blocking });
  if (issues.length && !input.confirmIssues) return { status: "needs_confirmation", issues };

  if (!input.confirmDuplicate) {
    const near = await db
      .select()
      .from(schema.fillups)
      .where(and(eq(schema.fillups.vehicleId, vehicle.id), isNull(schema.fillups.deletedAt), gte(schema.fillups.occurredAt, new Date(input.occurredAt.getTime() - 3_600_000)), lte(schema.fillups.occurredAt, new Date(input.occurredAt.getTime() + 3_600_000))));
    const dup = near.find((n) => isProbableDuplicate({ occurredAt: n.occurredAt, total: D(n.totalPaid), odometerKm: D(n.odometerKm) }, { occurredAt: input.occurredAt, total, odometerKm: input.odometerKm! }));
    if (dup)
      return {
        status: "needs_confirmation",
        duplicateOf: dup.id,
        issues: [{ code: "PROBABLE_DUPLICATE", level: "confirmable", message: "Un plein très proche (même montant, même compteur) existe déjà. Confirmez s'il s'agit bien de deux achats réels." }],
      };
  }

  for (const attId of [input.receiptAttachmentId, input.odometerAttachmentId].filter(Boolean) as string[]) {
    const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, attId));
    if (!a || a.ownerUserId !== ctx.userId) throw validation("Pièce jointe inconnue.");
  }
  if (input.receiptAttachmentId) {
    const [used] = await db.select({ id: schema.fillups.id }).from(schema.fillups).where(and(eq(schema.fillups.receiptAttachmentId, input.receiptAttachmentId), isNull(schema.fillups.deletedAt)));
    if (used) throw new AppError("DUPLICATE", "Ce ticket est déjà associé à un plein.", { fillupId: used.id });
  }

  const snapshot = await referenceSnapshot(db, vehicle.id, input.occurredAt, input.stationId, input.referencePrice);
  const [profile] = await db.select({ tz: schema.profiles.timeZone }).from(schema.profiles).where(eq(schema.profiles.userId, ctx.userId));
  const approval = vehicle.organizationId ? (access.role === "driver" ? "submitted" : "validated") : "not_required";

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.fillups)
        .values({
          vehicleId: vehicle.id,
          organizationId: vehicle.organizationId,
          createdBy: ctx.userId,
          driverUserId: input.driverUserId ?? (vehicle.organizationId ? ctx.userId : null),
          occurredAt: input.occurredAt,
          localDate: localDate(input.occurredAt, profile?.tz ?? "Europe/Paris"),
          odometerKm: toDb(input.odometerKm!, 1),
          isFull: input.isFull,
          startsNewBaseline: input.startsNewBaseline,
          missedBefore: input.missedBefore,
          stationId: input.stationId ?? null,
          stationLabel: input.stationLabel ?? null,
          totalPaid: toDb(total, 4),
          displayedTotal: toDb(sum(lines.map((l) => l.liters.times(l.unitPrice))), 4),
          discount: toDb(sum(lines.map((l) => l.discount)), 4),
          currency: vehicle.currency,
          usage: input.usage,
          category: input.category ?? null,
          source: ctx.isDemo ? "demo" : input.source,
          receiptAttachmentId: input.receiptAttachmentId ?? null,
          odometerAttachmentId: input.odometerAttachmentId ?? null,
          refPriceFuel: snapshot?.fuel ?? null,
          refPrice: snapshot ? toDb(snapshot.price, 4) : null,
          refPriceSource: snapshot?.source ?? null,
          refPriceObservedAt: snapshot?.observedAt ?? null,
          approvalStatus: approval,
          reimbursable: input.reimbursable,
          accountingFields: input.accountingFields,
          correctionNote: input.confirmIssues ? (input.confirmNote ?? "Confirmé par l'utilisateur") : null,
          idempotencyKey,
        })
        .returning();
      await tx.insert(schema.fillupLines).values(
        lines.map((l) => ({ fillupId: row.id, fuel: l.fuel, liters: toDb(l.liters, 3), displayedUnitPrice: toDb(l.unitPrice, 4), amountPaid: toDb(l.amount, 4) })),
      );
      await recomputeVehicle(tx, vehicle.id);
      await audit(tx, { actorUserId: ctx.userId, organizationId: vehicle.organizationId, action: "fillup.create", resourceType: "fillup", resourceId: row.id, details: { total: row.totalPaid, confirmed: input.confirmIssues } });
      return { status: "created" as const, fillup: row };
    });
  } catch (e) {
    // Course entre deux soumissions de la même clé (double clic, synchronisation) : on renvoie l'existant.
    if (idempotencyKey && String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === "23505") {
      const [existing] = await db.select().from(schema.fillups).where(and(eq(schema.fillups.createdBy, ctx.userId), eq(schema.fillups.idempotencyKey, idempotencyKey)));
      if (existing) return { status: "existing", fillup: existing };
      throw new AppError("DUPLICATE", "Ce ticket est déjà associé à un plein.");
    }
    throw e;
  }
}

export const fillupPatch = fillupInput.omit({ vehicleId: true, source: true }).partial().extend({ correctionReason: z.string().max(500).optional() });

/**
 * Correction d'un plein (verrou optimiste). Recalcule les intervalles voisins et les agrégats ;
 * les virements déjà exécutés ne sont pas touchés (cas G). En période close : refus, sauf
 * correction explicite par un administrateur, motivée et journalisée (cas J).
 */
export async function updateFillup(db: DB, ctx: Ctx, fillupId: string, raw: z.input<typeof fillupPatch>, expectedVersion: number, opts: { closedPeriodCorrection?: boolean } = {}) {
  const { fillup, vehicle, role } = await requireFillup(db, ctx, fillupId, "write");
  if (role === "driver" && fillup.reimbursedAt) throw new AppError("FORBIDDEN", "Ce plein a déjà été remboursé : demandez une correction à votre gestionnaire.");
  const parsed = fillupPatch.safeParse(raw);
  if (!parsed.success) throw validation("Correction invalide.", parsed.error.flatten());
  const p = parsed.data;
  if (vehicle.organizationId) {
    const closed = (await isInClosedPeriod(db, vehicle.organizationId, fillup.occurredAt)) || (p.occurredAt ? await isInClosedPeriod(db, vehicle.organizationId, p.occurredAt) : false);
    if (closed) {
      if (!opts.closedPeriodCorrection) throw new AppError("PERIOD_CLOSED", "Période clôturée : modification ordinaire impossible. Utilisez une correction tracée.");
      if (!["owner", "fleet_admin"].includes(role as string)) throw new AppError("FORBIDDEN", "Seul un administrateur peut corriger une période clôturée.");
      if (!p.correctionReason?.trim()) throw validation("Indiquez le motif de la correction.");
    }
  }
  const lines = p.lines ? resolveLines(p.lines) : null;
  if (lines && !Array.isArray(lines)) return { status: "amount_mismatch" as const, ...lines };

  // Mêmes contrôles qu'à la création : date future et volume nul refusés, compteur incohérent signalé.
  const occurredAt = p.occurredAt ?? fillup.occurredAt;
  const odometer = p.odometerKm ? D(p.odometerKm) : D(fillup.odometerKm);
  const currentLines = lines ?? (await db.select().from(schema.fillupLines).where(eq(schema.fillupLines.fillupId, fillupId))).map((l) => ({ liters: D(l.liters) }));
  const events = await db.select().from(schema.odometerEvents).where(eq(schema.odometerEvents.vehicleId, vehicle.id));
  const norm = (raw: string | Decimal, at: Date) => normalizeOdometer(D(raw), at, events);
  const { previous, next } = await neighbours(db, vehicle.id, occurredAt, odometer.toString(), fillupId);
  const issues = validateFillup({
    occurredAt,
    odometerKm: norm(odometer, occurredAt),
    liters: sum(currentLines.map((l) => l.liters)),
    tankCapacityL: vehicle.tankCapacityL ? D(vehicle.tankCapacityL) : null,
    previous: previous ? { occurredAt: previous.occurredAt, odometerKm: norm(previous.odometerKm, previous.occurredAt) } : null,
    next: next ? { occurredAt: next.occurredAt, odometerKm: norm(next.odometerKm, next.occurredAt) } : null,
  });
  const blocking = issues.filter((i) => i.level === "blocking");
  if (blocking.length) throw validation(blocking.map((b) => b.message).join(" "), { issues: blocking });
  const warnings = issues.map((i) => i.message);

  const [profile] = await db.select({ tz: schema.profiles.timeZone }).from(schema.profiles).where(eq(schema.profiles.userId, fillup.createdBy));

  return db.transaction(async (tx) => {
    const before = { ...fillup };
    const patch: Partial<typeof schema.fillups.$inferInsert> = { updatedAt: new Date(), version: fillup.version + 1 };
    if (p.occurredAt) {
      patch.occurredAt = p.occurredAt;
      patch.localDate = localDate(p.occurredAt, profile?.tz ?? "Europe/Paris");
    }
    if (p.odometerKm) patch.odometerKm = toDb(p.odometerKm, 1);
    if (p.isFull !== undefined) patch.isFull = p.isFull;
    if (p.startsNewBaseline !== undefined) patch.startsNewBaseline = p.startsNewBaseline;
    if (p.missedBefore !== undefined) patch.missedBefore = p.missedBefore;
    if (p.stationId !== undefined) patch.stationId = p.stationId;
    if (p.stationLabel !== undefined) patch.stationLabel = p.stationLabel;
    if (p.usage) patch.usage = p.usage;
    if (p.category !== undefined) patch.category = p.category;
    // Prix de référence revu si l'utilisateur en saisit un, ou si la date ou la station changent.
    const stationChanged = p.stationId !== undefined && p.stationId !== fillup.stationId;
    const dateChanged = Boolean(p.occurredAt) && p.occurredAt!.getTime() !== fillup.occurredAt.getTime();
    if (p.referencePrice || stationChanged || (dateChanged && fillup.refPriceSource?.startsWith("station:"))) {
      const snap = await referenceSnapshot(tx, vehicle.id, occurredAt, p.stationId !== undefined ? p.stationId : fillup.stationId, p.referencePrice ?? null);
      if (snap) Object.assign(patch, { refPriceFuel: snap.fuel, refPrice: toDb(snap.price, 4), refPriceSource: snap.source, refPriceObservedAt: snap.observedAt });
    }
    if (p.accountingFields) patch.accountingFields = p.accountingFields;
    if (opts.closedPeriodCorrection) patch.correctionNote = p.correctionReason ?? null;
    if (lines) {
      patch.totalPaid = toDb(sum(lines.map((l) => l.amount)), 4);
      patch.displayedTotal = toDb(sum(lines.map((l) => l.liters.times(l.unitPrice))), 4);
      patch.discount = toDb(sum(lines.map((l) => l.discount)), 4);
    }
    // Un conducteur qui modifie un plein déjà validé (ou refusé) le renvoie en validation :
    // le gestionnaire revoit le montant avant tout remboursement.
    if (role === "driver" && ["to_complete", "validated", "rejected"].includes(fillup.approvalStatus)) patch.approvalStatus = "submitted";
    const [row] = await tx.update(schema.fillups).set(patch).where(and(eq(schema.fillups.id, fillupId), eq(schema.fillups.version, expectedVersion))).returning();
    if (!row) throw new AppError("VERSION_CONFLICT", "Ce plein a été modifié entre-temps. Rechargez pour voir la dernière version avant de corriger.");
    if (lines) {
      await tx.delete(schema.fillupLines).where(eq(schema.fillupLines.fillupId, fillupId));
      await tx.insert(schema.fillupLines).values(lines.map((l) => ({ fillupId, fuel: l.fuel, liters: toDb(l.liters, 3), displayedUnitPrice: toDb(l.unitPrice, 4), amountPaid: toDb(l.amount, 4) })));
    }
    await recomputeVehicle(tx, vehicle.id);
    await audit(tx, {
      actorUserId: ctx.userId,
      organizationId: vehicle.organizationId,
      action: opts.closedPeriodCorrection ? "fillup.correction_closed_period" : "fillup.update",
      resourceType: "fillup",
      resourceId: fillupId,
      details: { reason: p.correctionReason ?? null, before: { total: before.totalPaid, odometer: before.odometerKm, occurredAt: before.occurredAt }, after: { total: row.totalPaid, odometer: row.odometerKm, occurredAt: row.occurredAt } },
    });
    return { status: "updated" as const, fillup: row, warnings };
  });
}

/** Suppression tracée (logique) : le plein disparaît des calculs mais reste dans le journal. */
export async function deleteFillup(db: DB, ctx: Ctx, fillupId: string, reason: string) {
  const { fillup, vehicle } = await requireFillup(db, ctx, fillupId, "write");
  if (vehicle.organizationId && (await isInClosedPeriod(db, vehicle.organizationId, fillup.occurredAt)))
    throw new AppError("PERIOD_CLOSED", "Période clôturée : suppression impossible. Demandez une réouverture.");
  await db.transaction(async (tx) => {
    await tx.update(schema.fillups).set({ deletedAt: new Date(), deletedReason: reason.slice(0, 300) || "Suppression utilisateur", updatedAt: new Date() }).where(eq(schema.fillups.id, fillupId));
    await recomputeVehicle(tx, vehicle.id);
    await audit(tx, { actorUserId: ctx.userId, organizationId: vehicle.organizationId, action: "fillup.delete", resourceType: "fillup", resourceId: fillupId, details: { reason } });
  });
}

export interface FillupFilters {
  vehicleId?: string;
  organizationId?: string;
  from?: Date;
  to?: Date;
  fuel?: FuelCode;
  usage?: "personnel" | "professionnel" | "mixte";
  driverUserId?: string;
  q?: string;
  approvalStatus?: string;
  limit?: number;
  offset?: number;
}

/** Historique filtrable, paginé, limité aux ressources autorisées. */
export async function listFillups(db: DBOrTx, ctx: Ctx, f: FillupFilters) {
  let vehicleIds: string[];
  let driverOnly = false;
  if (f.vehicleId) {
    const access = await requireVehicle(db, ctx, f.vehicleId, "read");
    vehicleIds = [f.vehicleId];
    driverOnly = access.role === "driver";
  } else if (f.organizationId) {
    const { listVehicles } = await import("./vehicles");
    const vs = await listVehicles(db, ctx, { organizationId: f.organizationId, includeArchived: true });
    vehicleIds = vs.map((v) => v.id);
    const { membershipOf } = await import("../authz");
    driverOnly = (await membershipOf(db, ctx, f.organizationId))?.role === "driver";
  } else {
    const vs = await db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(eq(schema.vehicles.ownerUserId, ctx.userId));
    vehicleIds = vs.map((v) => v.id);
  }
  if (vehicleIds.length === 0) return { rows: [], total: 0 };
  const where = and(
    inArray(schema.fillups.vehicleId, vehicleIds),
    isNull(schema.fillups.deletedAt),
    f.from ? gte(schema.fillups.occurredAt, f.from) : undefined,
    f.to ? lte(schema.fillups.occurredAt, f.to) : undefined,
    f.usage ? eq(schema.fillups.usage, f.usage) : undefined,
    f.driverUserId ? eq(schema.fillups.driverUserId, f.driverUserId) : undefined,
    driverOnly ? sql`(${schema.fillups.driverUserId} = ${ctx.userId} or ${schema.fillups.createdBy} = ${ctx.userId})` : undefined,
    f.approvalStatus ? eq(schema.fillups.approvalStatus, f.approvalStatus as "submitted") : undefined,
    f.fuel ? sql`exists (select 1 from fillup_lines fl where fl.fillup_id = ${schema.fillups.id} and fl.fuel = ${f.fuel})` : undefined,
    f.q ? sql`(${schema.fillups.stationLabel} ilike ${"%" + f.q + "%"} or ${schema.fillups.category} ilike ${"%" + f.q + "%"})` : undefined,
  );
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await db.select().from(schema.fillups).where(where).orderBy(desc(schema.fillups.occurredAt)).limit(limit).offset(f.offset ?? 0);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.fillups).where(where);
  const lines = rows.length ? await db.select().from(schema.fillupLines).where(inArray(schema.fillupLines.fillupId, rows.map((r) => r.id))) : [];
  return { rows: rows.map((r) => ({ ...r, lines: lines.filter((l) => l.fillupId === r.id) })), total: count };
}

export async function getFillup(db: DBOrTx, ctx: Ctx, fillupId: string) {
  const { fillup, vehicle } = await requireFillup(db, ctx, fillupId, "read");
  const lines = await db.select().from(schema.fillupLines).where(eq(schema.fillupLines.fillupId, fillupId));
  return { fillup, vehicle, lines };
}
