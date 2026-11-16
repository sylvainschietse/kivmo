import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { AppError, notFound, validation } from "../errors";
import { requireOrgRole, requireVehicle, type Ctx } from "../authz";
import { audit } from "../audit";

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  brouillon: "Brouillon",
  envoye: "Envoyée",
  recu: "Reçue par le professionnel",
  contacte: "Contacté",
  devis: "Devis transmis",
  installation: "Installation réalisée",
  clos: "Clos",
};

/** Garde-fou : pas d'envoi généralisé à des dizaines de garages. */
export const MAX_QUOTE_RECIPIENTS = 3;

export async function listPartners(db: DBOrTx, opts: { includeDemo: boolean; service?: string | null; zone?: string | null }) {
  const rows = await db.select().from(schema.partners).where(and(isNotNull(schema.partners.verifiedAt), opts.includeDemo ? undefined : eq(schema.partners.isDemo, false)));
  return rows.filter((p) => (!opts.service || p.services.includes(opts.service)) && (!opts.zone || p.zones.some((z) => z.startsWith(opts.zone!))));
}

/**
 * Demande de devis : véhicule, besoin, zone, moyen de contact choisi et consentement nominatif à
 * chaque destinataire. Création en brouillon, puis confirmation explicite avant envoi.
 */
export async function draftQuoteRequest(db: DB, ctx: Ctx, input: { vehicleId?: string | null; need: string; zone: string; contactChannel: "email" | "telephone"; contactValue: string; partnerIds: string[] }) {
  if (!input.need.trim() || !input.zone.trim() || !input.contactValue.trim()) throw validation("Besoin, zone et contact sont requis.");
  const ids = [...new Set(input.partnerIds)];
  if (ids.length === 0) throw validation("Choisissez au moins un professionnel.");
  if (ids.length > MAX_QUOTE_RECIPIENTS) throw validation(`Au maximum ${MAX_QUOTE_RECIPIENTS} professionnels par demande.`);
  let vehicleSummary: string | null = null;
  if (input.vehicleId) {
    const { vehicle } = await requireVehicle(db, ctx, input.vehicleId, "read");
    vehicleSummary = [vehicle.make, vehicle.model, vehicle.year, vehicle.engine].filter(Boolean).join(" ") || vehicle.name;
  }
  const partners = await db.select().from(schema.partners).where(inArray(schema.partners.id, ids));
  if (partners.length !== ids.length || partners.some((p) => !p.verifiedAt)) throw validation("Professionnel inconnu ou non vérifié.");
  const [req] = await db.insert(schema.quoteRequests).values({ userId: ctx.userId, vehicleId: input.vehicleId ?? null, need: input.need, zone: input.zone, contactChannel: input.contactChannel, contactValue: input.contactValue, vehicleSummary }).returning();
  return { request: req, partners };
}

export async function sendQuoteRequest(db: DB, ctx: Ctx, requestId: string, consentedPartnerIds: string[], partnerIds: string[]) {
  const [req] = await db.select().from(schema.quoteRequests).where(eq(schema.quoteRequests.id, requestId));
  if (!req || req.userId !== ctx.userId) throw notFound("Demande introuvable.");
  if (req.sentAt) throw new AppError("CONFLICT", "Demande déjà envoyée.");
  const ids = [...new Set(partnerIds)];
  if (ids.length === 0 || ids.length > MAX_QUOTE_RECIPIENTS) throw validation("Nombre de destinataires invalide.");
  if (!ids.every((id) => consentedPartnerIds.includes(id))) throw validation("Le consentement doit être donné nominativement pour chaque professionnel.");
  await db.transaction(async (tx) => {
    for (const pid of ids) {
      const [consent] = await tx.insert(schema.consentRecords).values({ userId: ctx.userId, purpose: "partage_partenaire", scope: `partner:${pid};request:${req.id}`, textVersion: "devis-2026-11" }).returning();
      await tx.insert(schema.requestRecipients).values({ quoteRequestId: req.id, partnerId: pid, consentRecordId: consent.id, status: "envoye", statusHistory: [{ status: "envoye", at: new Date().toISOString(), by: "client" }] });
    }
    await tx.update(schema.quoteRequests).set({ sentAt: new Date(), updatedAt: new Date() }).where(eq(schema.quoteRequests.id, req.id));
    await audit(tx, { actorUserId: ctx.userId, action: "quote.send", resourceType: "quote_request", resourceId: req.id, details: { recipients: ids.length } });
  });
  // Notification des professionnels : par email si un fournisseur est configuré, sinon visible dans leur espace.
}

export async function myQuoteRequests(db: DBOrTx, ctx: Ctx) {
  const reqs = await db.select().from(schema.quoteRequests).where(eq(schema.quoteRequests.userId, ctx.userId)).orderBy(desc(schema.quoteRequests.createdAt));
  if (!reqs.length) return [];
  const recips = await db.select({ r: schema.requestRecipients, p: schema.partners }).from(schema.requestRecipients).innerJoin(schema.partners, eq(schema.partners.id, schema.requestRecipients.partnerId)).where(inArray(schema.requestRecipients.quoteRequestId, reqs.map((r) => r.id)));
  return reqs.map((r) => ({ request: r, recipients: recips.filter((x) => x.r.quoteRequestId === r.id) }));
}

/** Retrait du consentement de partage : le professionnel ne voit plus les coordonnées. */
export async function withdrawQuoteConsent(db: DB, ctx: Ctx, recipientId: string) {
  const [rec] = await db.select({ r: schema.requestRecipients, q: schema.quoteRequests }).from(schema.requestRecipients).innerJoin(schema.quoteRequests, eq(schema.quoteRequests.id, schema.requestRecipients.quoteRequestId)).where(eq(schema.requestRecipients.id, recipientId));
  if (!rec || rec.q.userId !== ctx.userId) throw notFound("Demande introuvable.");
  await db.update(schema.consentRecords).set({ revokedAt: new Date() }).where(eq(schema.consentRecords.id, rec.r.consentRecordId));
  await db.update(schema.requestRecipients).set({ status: "clos", statusHistory: [...rec.r.statusHistory, { status: "clos", at: new Date().toISOString(), by: "client (retrait du consentement)" }], updatedAt: new Date() }).where(eq(schema.requestRecipients.id, recipientId));
}

/* ── Espace garage ── */

async function partnerForOrg(db: DBOrTx, ctx: Ctx, organizationId: string) {
  await requireOrgRole(db, ctx, organizationId, "read");
  const [p] = await db.select().from(schema.partners).where(eq(schema.partners.organizationId, organizationId));
  if (!p) throw notFound("Aucune fiche professionnelle liée à cette organisation.");
  return p;
}

/** Demandes entrantes : seules les demandes adressées à ce professionnel, avec consentement actif. Aucun accès aux comptes bancaires ni trajets. */
export async function incomingRequests(db: DBOrTx, ctx: Ctx, organizationId: string) {
  const partner = await partnerForOrg(db, ctx, organizationId);
  const rows = await db
    .select({ r: schema.requestRecipients, q: schema.quoteRequests, c: schema.consentRecords })
    .from(schema.requestRecipients)
    .innerJoin(schema.quoteRequests, eq(schema.quoteRequests.id, schema.requestRecipients.quoteRequestId))
    .innerJoin(schema.consentRecords, eq(schema.consentRecords.id, schema.requestRecipients.consentRecordId))
    .where(eq(schema.requestRecipients.partnerId, partner.id))
    .orderBy(desc(schema.requestRecipients.createdAt));
  return {
    partner,
    requests: rows.map(({ r, q, c }) => ({
      recipientId: r.id,
      status: r.status,
      history: r.statusHistory,
      need: q.need,
      zone: q.zone,
      vehicleSummary: q.vehicleSummary,
      contact: c.revokedAt ? null : { channel: q.contactChannel, value: q.contactValue },
      consentRevoked: Boolean(c.revokedAt),
      sentAt: q.sentAt,
    })),
  };
}

export async function updateRequestStatus(db: DB, ctx: Ctx, organizationId: string, recipientId: string, status: "recu" | "contacte" | "devis" | "installation" | "clos") {
  const partner = await partnerForOrg(db, ctx, organizationId);
  const [rec] = await db.select().from(schema.requestRecipients).where(and(eq(schema.requestRecipients.id, recipientId), eq(schema.requestRecipients.partnerId, partner.id)));
  if (!rec) throw notFound("Demande introuvable.");
  await db.update(schema.requestRecipients).set({ status, statusHistory: [...rec.statusHistory, { status, at: new Date().toISOString(), by: "professionnel" }], updatedAt: new Date() }).where(eq(schema.requestRecipients.id, recipientId));
  await audit(db, { actorUserId: ctx.userId, organizationId, action: "quote.status", resourceType: "request_recipient", resourceId: recipientId, details: { status } });
}

export async function activeSponsoredOffers(db: DBOrTx, includeDemo: boolean) {
  const now = new Date();
  const rows = await db.select().from(schema.sponsoredOffers).where(includeDemo ? undefined : eq(schema.sponsoredOffers.isDemo, false));
  return rows.filter((o) => o.startsAt <= now && o.endsAt >= now);
}
