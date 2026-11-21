import { and, eq, isNull, or, sql } from "drizzle-orm";
import { schema, type DBOrTx } from "@/db/client";
import { forbidden, notFound } from "./errors";

/** Contexte d'appel : toujours résolu côté serveur depuis la session, jamais depuis le client. */
export interface Ctx {
  userId: string;
  isDemo: boolean;
  isPlatformAdmin: boolean;
}

export type OrgRole = (typeof schema.orgRole.enumValues)[number];
export type Action = "read" | "write" | "admin" | "export" | "add_fillup";

const ORG_CAN: Record<OrgRole, Action[]> = {
  owner: ["read", "write", "admin", "export", "add_fillup"],
  fleet_admin: ["read", "write", "admin", "export", "add_fillup"],
  manager: ["read", "write", "export", "add_fillup"],
  driver: ["read", "add_fillup", "export"],
  accountant: ["read", "export"],
};

export async function membershipOf(db: DBOrTx, ctx: Ctx, organizationId: string) {
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.userId, ctx.userId),
        or(isNull(schema.memberships.endsAt), sql`${schema.memberships.endsAt} > now()`),
      ),
    );
  return m ?? null;
}

export async function requireOrgRole(db: DBOrTx, ctx: Ctx, organizationId: string, action: Action) {
  const m = await membershipOf(db, ctx, organizationId);
  if (!m) throw notFound("Organisation introuvable.");
  if (!ORG_CAN[m.role].includes(action)) throw forbidden();
  return m;
}

/** Contrôle d'accès à un véhicule, appliqué au serveur sur chaque ressource. */
export async function requireVehicle(db: DBOrTx, ctx: Ctx, vehicleId: string, action: Action) {
  const [v] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId));
  if (!v) throw notFound("Véhicule introuvable.");
  if (v.ownerUserId) {
    if (v.ownerUserId !== ctx.userId) throw notFound("Véhicule introuvable.");
    return { vehicle: v, role: "owner" as OrgRole | "personal", membership: null };
  }
  const m = await membershipOf(db, ctx, v.organizationId!);
  if (!m) throw notFound("Véhicule introuvable.");
  if (!ORG_CAN[m.role].includes(action)) throw forbidden();
  if (m.role === "manager" && m.teamId && v.teamId !== m.teamId) throw notFound("Véhicule introuvable.");
  if (m.role === "driver") {
    const [a] = await db
      .select({ id: schema.vehicleAssignments.id })
      .from(schema.vehicleAssignments)
      .where(and(eq(schema.vehicleAssignments.vehicleId, v.id), eq(schema.vehicleAssignments.userId, ctx.userId), or(isNull(schema.vehicleAssignments.endsAt), sql`${schema.vehicleAssignments.endsAt} > now()`)));
    if (!a) throw notFound("Véhicule introuvable.");
  }
  return { vehicle: v, role: m.role as OrgRole | "personal", membership: m };
}

export async function requireFillup(db: DBOrTx, ctx: Ctx, fillupId: string, action: Action) {
  const [f] = await db.select().from(schema.fillups).where(eq(schema.fillups.id, fillupId));
  if (!f || f.deletedAt) throw notFound("Plein introuvable.");
  const access = await requireVehicle(db, ctx, f.vehicleId, action === "write" ? "add_fillup" : action);
  if (access.role === "driver" && f.driverUserId !== ctx.userId && f.createdBy !== ctx.userId) throw notFound("Plein introuvable.");
  if (action === "write" && access.role === "accountant") throw forbidden();
  return { fillup: f, ...access };
}

/** Pièce jointe : propriétaire, ou membre autorisé sur un plein qui la référence (cas I). */
export async function requireAttachment(db: DBOrTx, ctx: Ctx, attachmentId: string) {
  const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, attachmentId));
  if (!a) throw notFound("Pièce introuvable.");
  if (a.ownerUserId === ctx.userId) return a;
  if (!a.organizationId) throw notFound("Pièce introuvable.");
  const [f] = await db
    .select({ id: schema.fillups.id })
    .from(schema.fillups)
    .where(or(eq(schema.fillups.receiptAttachmentId, a.id), eq(schema.fillups.odometerAttachmentId, a.id)));
  if (!f) throw notFound("Pièce introuvable.");
  await requireFillup(db, ctx, f.id, "read");
  return a;
}
