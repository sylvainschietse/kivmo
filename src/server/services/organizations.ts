import { and, desc, eq, gt, inArray, isNull, sql, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { D, Decimal, sum, ZERO } from "@/lib/decimal";
import { AppError, validation } from "../errors";
import { membershipOf, requireFillup, requireOrgRole, type Ctx, type OrgRole } from "../authz";
import { audit } from "../audit";
import { randomToken, sha256 } from "../auth";
import { sendEmail } from "@/integrations/email";
import { env } from "../env";
import { loadVehicleData } from "./recompute";
import { listVehicles } from "./vehicles";
import { averageConsumption } from "@/domain/consumption";

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Propriétaire",
  fleet_admin: "Administrateur flotte",
  manager: "Gestionnaire",
  driver: "Conducteur",
  accountant: "Comptable (lecture/export)",
};

export async function createOrganization(db: DB, ctx: Ctx, input: { name: string; kind?: "foyer" | "entreprise" | "partenaire" }) {
  const name = input.name.trim();
  if (!name) throw validation("Nom requis.");
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(schema.organizations).values({ name, kind: input.kind ?? "entreprise", isDemo: ctx.isDemo }).returning();
    await tx.insert(schema.memberships).values({ organizationId: org.id, userId: ctx.userId, role: "owner" });
    await audit(tx, { actorUserId: ctx.userId, organizationId: org.id, action: "org.create", resourceType: "organization", resourceId: org.id });
    return org;
  });
}

export async function myOrganizations(db: DBOrTx, ctx: Ctx) {
  return db
    .select({ org: schema.organizations, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(and(eq(schema.memberships.userId, ctx.userId), isNull(schema.memberships.endsAt)));
}

export async function listMembers(db: DBOrTx, ctx: Ctx, organizationId: string) {
  await requireOrgRole(db, ctx, organizationId, "read");
  return db
    .select({ membership: schema.memberships, email: schema.users.email, displayName: schema.users.displayName })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, organizationId));
}

const inviteSchema = z.object({ email: z.string().email(), role: z.enum(["fleet_admin", "manager", "driver", "accountant"]) });

/** Invitation avec expiration (7 jours) et révocation. */
export async function inviteMember(db: DB, ctx: Ctx, organizationId: string, raw: { email: string; role: string }) {
  await requireOrgRole(db, ctx, organizationId, "admin");
  const p = inviteSchema.safeParse(raw);
  if (!p.success) throw validation("Invitation invalide.", p.error.flatten());
  const token = randomToken();
  const [inv] = await db
    .insert(schema.invitations)
    .values({ organizationId, email: p.data.email.toLowerCase(), role: p.data.role, tokenHash: sha256(token), invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) })
    .returning();
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  const link = `${env.appUrl}/invitation?token=${encodeURIComponent(token)}`;
  let delivery: string;
  try {
    delivery = ctx.isDemo ? "demo" : await sendEmail({ to: p.data.email, subject: `Invitation à rejoindre ${org.name} sur KIVMO`, text: `Vous êtes invité(e) à rejoindre ${org.name} (${ROLE_LABELS[p.data.role]}).\nLien valable 7 jours : ${link}` });
  } catch {
    delivery = "non_envoye";
  }
  await audit(db, { actorUserId: ctx.userId, organizationId, action: "invitation.create", resourceType: "invitation", resourceId: inv.id, details: { role: p.data.role } });
  return { invitation: inv, link: delivery === "console" || delivery === "demo" || delivery === "non_envoye" ? link : null, delivery };
}

export async function revokeInvitation(db: DB, ctx: Ctx, invitationId: string) {
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invitationId));
  if (!inv) throw new AppError("NOT_FOUND", "Invitation introuvable.");
  await requireOrgRole(db, ctx, inv.organizationId, "admin");
  await db.update(schema.invitations).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(schema.invitations.id, invitationId));
  await audit(db, { actorUserId: ctx.userId, organizationId: inv.organizationId, action: "invitation.revoke", resourceType: "invitation", resourceId: inv.id });
}

export async function acceptInvitation(db: DB, ctx: Ctx, token: string) {
  const [inv] = await db
    .select()
    .from(schema.invitations)
    .where(and(eq(schema.invitations.tokenHash, sha256(token)), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date())));
  if (!inv) throw new AppError("SESSION_EXPIRED", "Invitation expirée, révoquée ou déjà utilisée.");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId));
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) throw new AppError("FORBIDDEN", "Cette invitation est destinée à une autre adresse email.");
  return db.transaction(async (tx) => {
    await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, inv.id));
    await tx.insert(schema.memberships).values({ organizationId: inv.organizationId, userId: ctx.userId, role: inv.role }).onConflictDoUpdate({ target: [schema.memberships.organizationId, schema.memberships.userId], set: { role: inv.role, endsAt: null } });
    await audit(tx, { actorUserId: ctx.userId, organizationId: inv.organizationId, action: "invitation.accept", resourceType: "invitation", resourceId: inv.id });
    return inv.organizationId;
  });
}

export async function listInvitations(db: DBOrTx, ctx: Ctx, organizationId: string) {
  await requireOrgRole(db, ctx, organizationId, "admin");
  return db.select().from(schema.invitations).where(eq(schema.invitations.organizationId, organizationId)).orderBy(desc(schema.invitations.createdAt));
}

export async function removeMember(db: DB, ctx: Ctx, organizationId: string, userId: string) {
  await requireOrgRole(db, ctx, organizationId, "admin");
  if (userId === ctx.userId) throw validation("Vous ne pouvez pas vous retirer vous-même.");
  await db.update(schema.memberships).set({ endsAt: new Date() }).where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, userId)));
  await audit(db, { actorUserId: ctx.userId, organizationId, action: "member.remove", resourceType: "membership", resourceId: userId });
}

export async function createTeam(db: DB, ctx: Ctx, organizationId: string, name: string, kind = "equipe") {
  await requireOrgRole(db, ctx, organizationId, "admin");
  const [t] = await db.insert(schema.teams).values({ organizationId, name, kind }).returning();
  return t;
}

/* ── Validation des pleins conducteurs ── */

export async function decideFillup(db: DB, ctx: Ctx, fillupId: string, decision: "validated" | "rejected" | "to_complete", reason?: string) {
  const { fillup } = await requireFillup(db, ctx, fillupId, "read");
  if (!fillup.organizationId) throw validation("Seuls les pleins d'organisation sont soumis à validation.");
  const m = await requireOrgRole(db, ctx, fillup.organizationId, "write");
  if (m.role === "driver") throw new AppError("FORBIDDEN", "Un conducteur ne peut pas valider.");
  if (decision !== "validated" && !reason?.trim()) throw validation("Indiquez la raison.");
  await db.transaction(async (tx) => {
    await tx.update(schema.fillups).set({ approvalStatus: decision, approvalReason: reason ?? null, updatedAt: new Date(), version: fillup.version + 1 }).where(eq(schema.fillups.id, fillupId));
    await tx.insert(schema.approvals).values({ organizationId: fillup.organizationId!, fillupId, decidedBy: ctx.userId, decision, reason: reason ?? null });
    await audit(tx, { actorUserId: ctx.userId, organizationId: fillup.organizationId, action: `approval.${decision}`, resourceType: "fillup", resourceId: fillupId, details: { reason } });
  });
}

export async function markReimbursed(db: DB, ctx: Ctx, fillupId: string) {
  const { fillup } = await requireFillup(db, ctx, fillupId, "read");
  if (!fillup.organizationId) throw validation("Plein personnel.");
  await requireOrgRole(db, ctx, fillup.organizationId, "admin");
  await db.update(schema.fillups).set({ reimbursedAt: new Date(), updatedAt: new Date() }).where(eq(schema.fillups.id, fillupId));
  await audit(db, { actorUserId: ctx.userId, organizationId: fillup.organizationId, action: "fillup.reimbursed", resourceType: "fillup", resourceId: fillupId });
}

/* ── Budgets ── */

export async function upsertBudget(db: DB, ctx: Ctx, organizationId: string, input: { scope: "flotte" | "equipe" | "vehicule"; scopeId?: string | null; period: "mensuel" | "annuel"; amount: string; alertThresholdPercent?: number }) {
  await requireOrgRole(db, ctx, organizationId, "admin");
  if (!/^\d+(\.\d+)?$/.test(input.amount)) throw validation("Montant invalide.");
  const [b] = await db.insert(schema.budgets).values({ organizationId, scope: input.scope, scopeId: input.scopeId ?? null, period: input.period, amount: input.amount, alertThresholdPercent: input.alertThresholdPercent ?? 80 }).returning();
  await audit(db, { actorUserId: ctx.userId, organizationId, action: "budget.create", resourceType: "budget", resourceId: b.id });
  return b;
}

export async function listBudgets(db: DBOrTx, ctx: Ctx, organizationId: string) {
  await requireOrgRole(db, ctx, organizationId, "read");
  return db.select().from(schema.budgets).where(eq(schema.budgets.organizationId, organizationId));
}

/* ── Tableau de bord flotte ── */

export interface FleetDashboard {
  from: Date;
  to: Date;
  totalSpend: Decimal;
  totalLiters: Decimal;
  documentedKm: Decimal;
  costPerKm: Decimal | null;
  consumptionL100: Decimal | null;
  byVehicle: { vehicleId: string; name: string; spend: Decimal; liters: Decimal; documentedKm: Decimal; consumptionL100: Decimal | null }[];
  byDriver: { userId: string | null; label: string; spend: Decimal; liters: Decimal; consumptionMeasured: boolean; consumptionL100: Decimal | null; note: string }[];
  budgets: { id: string; label: string; amount: Decimal; consumed: Decimal; ratio: Decimal; alert: boolean }[];
  missingReceipts: number;
  pendingApprovals: number;
  anomalies: { vehicleId: string; message: string }[];
}

export async function fleetDashboard(db: DBOrTx, ctx: Ctx, organizationId: string, from: Date, to: Date): Promise<FleetDashboard> {
  await requireOrgRole(db, ctx, organizationId, "read");
  const vehicles = await listVehicles(db, ctx, { organizationId, includeArchived: true });
  const vIds = vehicles.map((v) => v.id);
  const rows = vIds.length
    ? await db.select().from(schema.fillups).where(and(inArray(schema.fillups.vehicleId, vIds), isNull(schema.fillups.deletedAt), gte(schema.fillups.occurredAt, from), lte(schema.fillups.occurredAt, to)))
    : [];
  const lines = rows.length ? await db.select().from(schema.fillupLines).where(inArray(schema.fillupLines.fillupId, rows.map((r) => r.id))) : [];
  const litersOf = (id: string) => sum(lines.filter((l) => l.fillupId === id).map((l) => D(l.liters)));

  const byVehicle: FleetDashboard["byVehicle"] = [];
  const anomalies: FleetDashboard["anomalies"] = [];
  let documentedKm = ZERO;
  let measuredVolume = ZERO;
  for (const v of vehicles) {
    const data = await loadVehicleData(db, v.id);
    const intervals = data.analysis.intervals.filter((i) => i.closedAt >= from && i.closedAt <= to);
    const km = sum(intervals.filter((i) => i.status === "measured").map((i) => i.distanceKm));
    documentedKm = documentedKm.plus(km);
    measuredVolume = measuredVolume.plus(sum(intervals.filter((i) => i.status === "measured").map((i) => i.volumeL)));
    for (const i of intervals.filter((x) => x.status !== "measured")) anomalies.push({ vehicleId: v.id, message: `${v.name} : intervalle ${i.status === "invalid" ? "invalide" : "suspect"} clos le ${i.closedAt.toISOString().slice(0, 10)}` });
    const vr = rows.filter((r) => r.vehicleId === v.id);
    byVehicle.push({ vehicleId: v.id, name: v.name, spend: sum(vr.map((r) => D(r.totalPaid))), liters: sum(vr.map((r) => litersOf(r.id))), documentedKm: km, consumptionL100: averageConsumption(intervals) });
  }

  // Ratio par conducteur : seulement si des relevés d'affectation (début/fin) permettent l'attribution (cas K).
  const assignments = vIds.length ? await db.select().from(schema.vehicleAssignments).where(inArray(schema.vehicleAssignments.vehicleId, vIds)) : [];
  const users = await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, [...new Set(rows.map((r) => r.driverUserId).filter(Boolean) as string[])].concat(["00000000-0000-0000-0000-000000000000"])));
  const driverIds = [...new Set(rows.map((r) => r.driverUserId))];
  const byDriver: FleetDashboard["byDriver"] = driverIds.map((uid) => {
    const dr = rows.filter((r) => r.driverUserId === uid);
    const docs = assignments.filter((a) => a.userId === uid && a.startOdometerKm && a.endOdometerKm);
    const km = sum(docs.map((a) => D(a.endOdometerKm!).minus(a.startOdometerKm!)));
    const liters = sum(dr.map((r) => litersOf(r.id)));
    const u = users.find((x) => x.id === uid);
    const measured = docs.length > 0 && km.gt(0);
    return {
      userId: uid,
      label: uid ? (u?.name ?? u?.email ?? "Conducteur") : "Non attribué",
      spend: sum(dr.map((r) => D(r.totalPaid))),
      liters,
      consumptionMeasured: measured,
      consumptionL100: measured ? liters.times(100).div(km) : null,
      note: measured ? "Ratio calculé à partir des kilométrages de début et fin d'affectation." : "Dépenses attribuées uniquement : pas de relevés d'affectation permettant un ratio individuel.",
    };
  });

  const budgetRows = await db.select().from(schema.budgets).where(eq(schema.budgets.organizationId, organizationId));
  const now = new Date();
  const budgets = budgetRows.map((b) => {
    const start = b.period === "mensuel" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const scoped = rows.filter((r) => r.occurredAt >= start && (b.scope === "flotte" || (b.scope === "vehicule" && r.vehicleId === b.scopeId) || (b.scope === "equipe" && vehicles.find((v) => v.id === r.vehicleId)?.teamId === b.scopeId)));
    const consumed = sum(scoped.map((r) => D(r.totalPaid)));
    const ratio = D(b.amount).gt(0) ? consumed.div(b.amount) : ZERO;
    const label = b.scope === "flotte" ? `Flotte (${b.period})` : b.scope === "vehicule" ? `${vehicles.find((v) => v.id === b.scopeId)?.name ?? "Véhicule"} (${b.period})` : `Équipe (${b.period})`;
    return { id: b.id, label, amount: D(b.amount), consumed, ratio, alert: ratio.times(100).gte(b.alertThresholdPercent) };
  });

  const totalSpend = sum(rows.map((r) => D(r.totalPaid)));
  const totalLiters = sum(rows.map((r) => litersOf(r.id)));
  return {
    from,
    to,
    totalSpend,
    totalLiters,
    documentedKm,
    costPerKm: documentedKm.gt(0) ? sum(byVehicle.filter((b) => b.documentedKm.gt(0)).map((b) => b.spend)).div(documentedKm) : null,
    consumptionL100: documentedKm.gt(0) ? measuredVolume.times(100).div(documentedKm) : null,
    byVehicle,
    byDriver,
    budgets,
    missingReceipts: rows.filter((r) => !r.receiptAttachmentId && r.usage !== "personnel").length,
    pendingApprovals: rows.filter((r) => r.approvalStatus === "submitted").length,
    anomalies,
  };
}

export async function orgRole(db: DBOrTx, ctx: Ctx, organizationId: string) {
  return (await membershipOf(db, ctx, organizationId))?.role ?? null;
}

export { sql };
