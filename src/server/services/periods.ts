import { and, eq, gte, isNotNull, lte, desc } from "drizzle-orm";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { AppError, validation } from "../errors";
import { requireOrgRole, type Ctx } from "../authz";
import { audit } from "../audit";
import { dayInZone } from "@/lib/dates";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);


export async function isInClosedPeriod(db: DBOrTx, organizationId: string, at: Date) {
  // Jour civil en heure de Paris, comme les bornes des périodes et la date locale des pleins.
  const day = dayInZone(at);
  const [p] = await db
    .select()
    .from(schema.accountingPeriods)
    .where(and(eq(schema.accountingPeriods.organizationId, organizationId), lte(schema.accountingPeriods.startsOn, day), gte(schema.accountingPeriods.endsOn, day), isNotNull(schema.accountingPeriods.closedAt)));
  return Boolean(p);
}

export async function assertPeriodOpen(db: DBOrTx, organizationId: string, at: Date) {
  if (await isInClosedPeriod(db, organizationId, at)) throw new AppError("PERIOD_CLOSED", "Cette date appartient à une période clôturée.");
}

export async function listPeriods(db: DBOrTx, ctx: Ctx, organizationId: string) {
  await requireOrgRole(db, ctx, organizationId, "read");
  return db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.organizationId, organizationId)).orderBy(desc(schema.accountingPeriods.startsOn));
}

/** Clôture d'un mois (YYYY-MM). */
export async function closePeriod(db: DB, ctx: Ctx, organizationId: string, month: string) {
  await requireOrgRole(db, ctx, organizationId, "admin");
  if (!/^\d{4}-\d{2}$/.test(month)) throw validation("Mois invalide (AAAA-MM).");
  const [y, m] = month.split("-").map(Number);
  const startsOn = `${month}-01`;
  const endsOn = isoDate(new Date(Date.UTC(y, m, 0)));
  const [existing] = await db.select().from(schema.accountingPeriods).where(and(eq(schema.accountingPeriods.organizationId, organizationId), eq(schema.accountingPeriods.startsOn, startsOn)));
  if (existing?.closedAt) throw new AppError("CONFLICT", "Période déjà clôturée.");
  const pendingWhere = and(eq(schema.fillups.organizationId, organizationId), gte(schema.fillups.localDate, startsOn), lte(schema.fillups.localDate, endsOn), eq(schema.fillups.approvalStatus, "submitted"));
  const pending = await db.select({ id: schema.fillups.id }).from(schema.fillups).where(pendingWhere);
  if (existing) {
    await db.update(schema.accountingPeriods).set({ closedAt: new Date(), closedBy: ctx.userId, updatedAt: new Date(), version: existing.version + 1 }).where(eq(schema.accountingPeriods.id, existing.id));
  } else {
    await db.insert(schema.accountingPeriods).values({ organizationId, startsOn, endsOn, closedAt: new Date(), closedBy: ctx.userId });
  }
  await audit(db, { actorUserId: ctx.userId, organizationId, action: "period.close", resourceType: "accounting_period", resourceId: startsOn, details: { pendingApprovals: pending.length } });
  return { startsOn, endsOn, pendingApprovals: pending.length };
}

/** Réouverture autorisée et journalisée. */
export async function reopenPeriod(db: DB, ctx: Ctx, organizationId: string, month: string, reason: string) {
  await requireOrgRole(db, ctx, organizationId, "admin");
  if (!reason.trim()) throw validation("Le motif de réouverture est obligatoire.");
  const startsOn = `${month}-01`;
  const [p] = await db.select().from(schema.accountingPeriods).where(and(eq(schema.accountingPeriods.organizationId, organizationId), eq(schema.accountingPeriods.startsOn, startsOn)));
  if (!p?.closedAt) throw new AppError("CONFLICT", "Cette période n'est pas clôturée.");
  await db.update(schema.accountingPeriods).set({ closedAt: null, reopenedAt: new Date(), reopenedBy: ctx.userId, reopenReason: reason, updatedAt: new Date(), version: p.version + 1 }).where(eq(schema.accountingPeriods.id, p.id));
  await audit(db, { actorUserId: ctx.userId, organizationId, action: "period.reopen", resourceType: "accounting_period", resourceId: startsOn, details: { reason } });
}
