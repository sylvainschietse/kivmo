import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { D, Decimal, sum, toDb, ZERO } from "@/lib/decimal";
import { formatMoney } from "@/lib/format";
import { computeAmortization } from "@/domain/comparison";
import { savingsCapacity, splitAllocation, transferable, type ProjectFigures } from "@/domain/savings";
import { assertTransition, canTransition, IN_FLIGHT_STATES, type PaymentState } from "@/domain/payment-state";
import { AppError, notFound, validation } from "../errors";
import type { Ctx } from "../authz";
import { audit } from "../audit";
import { loadVehicleData } from "./recompute";
import { bankProvider, ProviderTimeoutError, signWebhook, SANDBOX_PROVIDER } from "@/integrations/bank";
import { env } from "../env";
import { safeEqual } from "../auth";
import { notify } from "./notifications";

/* ───────── Gains de l'utilisateur ───────── */

export interface UserGains {
  /** Somme des gains carburant calculés (mesurés et complets) — depuis la conversion le cas échéant. */
  calculatedGains: Decimal;
  conversionCost: Decimal;
  netAfterConversion: Decimal;
  incompleteComparisons: number;
  perVehicle: { vehicleId: string; name: string; gains: Decimal; conversionCost: Decimal; remaining: Decimal; amortizedAt: Date | null }[];
}

export async function userGains(db: DBOrTx, ctx: Ctx): Promise<UserGains> {
  const vehicles = await db.select().from(schema.vehicles).where(eq(schema.vehicles.ownerUserId, ctx.userId));
  const conv = vehicles.length ? await db.select().from(schema.conversions).where(inArray(schema.conversions.vehicleId, vehicles.map((v) => v.id))) : [];
  const perVehicle: UserGains["perVehicle"] = [];
  let incomplete = 0;
  for (const v of vehicles) {
    const data = await loadVehicleData(db, v.id);
    const c = conv.find((x) => x.vehicleId === v.id);
    const am = computeAmortization(data.analysis.intervals, data.comparisons, c ? { cost: D(c.cost), date: new Date(c.date), odometerKm: D(c.odometerKm) } : null);
    incomplete += am.incompleteCount;
    perVehicle.push({ vehicleId: v.id, name: v.name, gains: am.cumulativeGain, conversionCost: am.conversionCost, remaining: am.remainingToAmortize, amortizedAt: am.initialAmortizedAt });
  }
  const calculatedGains = sum(perVehicle.map((p) => p.gains));
  const conversionCost = sum(perVehicle.map((p) => p.conversionCost));
  return { calculatedGains, conversionCost, netAfterConversion: calculatedGains.minus(conversionCost), incompleteComparisons: incomplete, perVehicle };
}

/* ───────── Projets ───────── */

const decStr = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").replace(/\s/g, "")).refine((v) => /^\d+(\.\d+)?$/.test(v), "Montant invalide");

export const projectInput = z.object({
  name: z.string().trim().min(1).max(80),
  emoji: z.string().max(8).optional().nullable(),
  target: decStr.optional().nullable(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  priority: z.coerce.number().int().min(1).max(5).default(1),
  visibility: z.enum(["prive", "foyer"]).default("prive"),
  sharePercent: decStr.optional().nullable(),
  shareFixedAmount: decStr.optional().nullable(),
  isPrimary: z.boolean().default(false),
});

export async function createProject(db: DB, ctx: Ctx, raw: z.input<typeof projectInput>) {
  const p = projectInput.safeParse(raw);
  if (!p.success) throw validation("Projet invalide.", p.error.flatten());
  const existing = await db.select().from(schema.projects).where(and(eq(schema.projects.ownerUserId, ctx.userId), isNull(schema.projects.archivedAt)));
  const percentTotal = sum(existing.map((e) => D(e.sharePercent ?? 0))).plus(p.data.sharePercent ?? 0);
  if (percentTotal.gt(100)) throw validation("La somme des pourcentages de répartition dépasse 100 %.");
  const share = p.data.sharePercent ?? (p.data.shareFixedAmount ? null : existing.length === 0 ? "100" : null);
  const [row] = await db
    .insert(schema.projects)
    .values({ ownerUserId: ctx.userId, ...p.data, sharePercent: share, isPrimary: p.data.isPrimary || existing.length === 0 })
    .returning();
  await audit(db, { actorUserId: ctx.userId, action: "project.create", resourceType: "project", resourceId: row.id });
  return row;
}

export async function updateProjectShares(db: DB, ctx: Ctx, shares: { projectId: string; sharePercent?: string | null; shareFixedAmount?: string | null }[]) {
  const total = sum(shares.map((s) => D(s.sharePercent || 0)));
  if (total.gt(100)) throw validation("La somme des pourcentages dépasse 100 %.");
  await db.transaction(async (tx) => {
    for (const s of shares) {
      const [p] = await tx.select().from(schema.projects).where(eq(schema.projects.id, s.projectId));
      if (!p || p.ownerUserId !== ctx.userId) throw notFound("Projet introuvable.");
      await tx.update(schema.projects).set({ sharePercent: s.sharePercent || null, shareFixedAmount: s.shareFixedAmount || null, updatedAt: new Date(), version: p.version + 1 }).where(eq(schema.projects.id, p.id));
    }
  });
}

export async function archiveProject(db: DB, ctx: Ctx, projectId: string) {
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p || p.ownerUserId !== ctx.userId) throw notFound("Projet introuvable.");
  await db.update(schema.projects).set({ archivedAt: new Date(), sharePercent: null, updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
}

export interface ProjectView {
  project: typeof schema.projects.$inferSelect;
  figures: ProjectFigures;
  transferable: Decimal;
}

export async function projectFigures(db: DBOrTx, ctx: Ctx, projectIds?: string[]): Promise<ProjectView[]> {
  const projects = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.ownerUserId, ctx.userId), projectIds ? inArray(schema.projects.id, projectIds) : isNull(schema.projects.archivedAt)))
    .orderBy(schema.projects.priority, schema.projects.createdAt);
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const allocs = await db.select({ projectId: schema.allocations.projectId, total: sql<string>`sum(${schema.allocations.amount})` }).from(schema.allocations).where(inArray(schema.allocations.projectId, ids)).groupBy(schema.allocations.projectId);
  const entries = await db.select({ projectId: schema.savingsEntries.projectId, kind: schema.savingsEntries.kind, total: sql<string>`sum(${schema.savingsEntries.amount})` }).from(schema.savingsEntries).where(inArray(schema.savingsEntries.projectId, ids)).groupBy(schema.savingsEntries.projectId, schema.savingsEntries.kind);
  const orders = await db.select({ projectId: schema.paymentOrders.projectId, total: sql<string>`sum(${schema.paymentOrders.amount})` }).from(schema.paymentOrders).where(and(inArray(schema.paymentOrders.projectId, ids), inArray(schema.paymentOrders.state, IN_FLIGHT_STATES))).groupBy(schema.paymentOrders.projectId);
  return projects.map((project) => {
    const figures: ProjectFigures = {
      allocated: D(allocs.find((a) => a.projectId === project.id)?.total ?? 0),
      declaredManual: D(entries.find((e) => e.projectId === project.id && e.kind === "declared_manual")?.total ?? 0),
      bankConfirmed: D(entries.find((e) => e.projectId === project.id && e.kind === "bank_confirmed")?.total ?? 0),
      inFlight: D(orders.find((o) => o.projectId === project.id)?.total ?? 0),
    };
    return { project, figures, transferable: transferable(figures) };
  });
}

/** Verrou applicatif par utilisateur : sérialise affectations, déclarations et ordres. */
async function lockUser(tx: DBOrTx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"savings:" + userId}))`);
}

export async function savingsOverview(db: DBOrTx, ctx: Ctx) {
  const gains = await userGains(db, ctx);
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, ctx.userId));
  const [{ allocated }] = await db.select({ allocated: sql<string>`coalesce(sum(${schema.allocations.amount}), 0)` }).from(schema.allocations).where(eq(schema.allocations.ownerUserId, ctx.userId));
  const capacity = savingsCapacity({ calculatedGains: gains.calculatedGains, conversionCost: gains.conversionCost, deductConversion: profile?.deductConversionBeforeAllocation ?? true, alreadyAllocated: D(allocated) });
  return { gains, allocated: D(allocated), capacity, deductConversion: profile?.deductConversionBeforeAllocation ?? true };
}

/** Affecte la capacité disponible aux projets selon leur répartition, sans double affectation. */
export async function allocateAvailableGains(db: DB, ctx: Ctx) {
  return db.transaction(async (tx) => {
    await lockUser(tx, ctx.userId);
    const ov = await savingsOverview(tx, ctx);
    if (ov.capacity.capacity.lt("0.01")) return { lines: [], capacity: ov.capacity };
    const projects = await tx.select().from(schema.projects).where(and(eq(schema.projects.ownerUserId, ctx.userId), isNull(schema.projects.archivedAt)));
    const lines = splitAllocation(
      ov.capacity.capacity,
      projects.map((p) => ({ projectId: p.id, percent: p.sharePercent ? D(p.sharePercent) : null, fixedAmount: p.shareFixedAmount ? D(p.shareFixedAmount) : null })),
    );
    if (!lines.length) throw validation("Définissez une répartition (pourcentage ou montant) sur au moins un projet.");
    const batchId = crypto.randomUUID();
    await tx.insert(schema.allocations).values(
      lines.map((l) => ({ ownerUserId: ctx.userId, projectId: l.projectId, amount: toDb(l.amount, 4), batchId, basisSnapshot: { calculatedGains: ov.gains.calculatedGains.toString(), conversionCost: ov.gains.conversionCost.toString(), deductConversion: ov.deductConversion, capacity: ov.capacity.capacity.toString() } })),
    );
    await audit(tx, { actorUserId: ctx.userId, action: "allocation.batch", resourceType: "allocation", resourceId: batchId, details: { lines: lines.map((l) => ({ p: l.projectId, a: l.amount.toString() })) } });
    return { lines, capacity: ov.capacity };
  });
}

/** Virement déclaré manuellement : jamais présenté comme vérifié par la banque. */
export async function declareManualTransfer(db: DB, ctx: Ctx, input: { projectId: string; amount: string; occurredOn: string; note?: string }) {
  const amount = D(input.amount.replace(",", "."));
  if (amount.lte(0)) throw validation("Montant invalide.");
  return db.transaction(async (tx) => {
    await lockUser(tx, ctx.userId);
    const [view] = await projectFigures(tx, ctx, [input.projectId]);
    if (!view) throw notFound("Projet introuvable.");
    if (amount.gt(view.transferable))
      throw validation(`Ce montant dépasse ce qui reste à verser pour ce projet (${formatMoney(view.transferable)}). Un virement en cours ou déjà déclaré couvre peut-être déjà ces gains.`);
    const [row] = await tx.insert(schema.savingsEntries).values({ ownerUserId: ctx.userId, projectId: input.projectId, kind: "declared_manual", amount: toDb(amount, 4), occurredOn: input.occurredOn, provenance: "Déclaration manuelle de l'utilisateur", note: input.note ?? null }).returning();
    await audit(tx, { actorUserId: ctx.userId, action: "savings.declare_manual", resourceType: "savings_entry", resourceId: row.id, details: { amount: row.amount } });
    return row;
  });
}

/* ───────── Banque (bac à sable / production à connecter) ───────── */

export async function connectBank(db: DB, ctx: Ctx, consentTextVersion: string) {
  const provider = bankProvider();
  const res = await provider.connect(ctx.userId);
  return db.transaction(async (tx) => {
    const [consent] = await tx.insert(schema.consentRecords).values({ userId: ctx.userId, purpose: "banque", scope: "initiation_paiement", textVersion: consentTextVersion }).returning();
    const [conn] = await tx
      .insert(schema.bankConnections)
      .values({ ownerUserId: ctx.userId, provider: provider.name, environment: provider.environment, providerConnectionRef: res.connectionRef, accountLabel: res.accountLabel, ibanMasked: res.ibanMasked, ownershipVerified: res.ownershipVerified, canReadTransactions: res.canReadTransactions, canInitiatePayments: res.canInitiatePayments, consentRecordId: consent.id, consentExpiresAt: res.consentExpiresAt })
      .returning();
    await audit(tx, { actorUserId: ctx.userId, action: "bank.connect", resourceType: "bank_connection", resourceId: conn.id, details: { provider: provider.name, environment: provider.environment } });
    return conn;
  });
}

export async function revokeBank(db: DB, ctx: Ctx, connectionId: string) {
  const [c] = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.id, connectionId));
  if (!c || c.ownerUserId !== ctx.userId) throw notFound("Connexion introuvable.");
  await db.update(schema.bankConnections).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(schema.bankConnections.id, connectionId));
  if (c.consentRecordId) await db.update(schema.consentRecords).set({ revokedAt: new Date() }).where(eq(schema.consentRecords.id, c.consentRecordId));
  await audit(db, { actorUserId: ctx.userId, action: "bank.revoke", resourceType: "bank_connection", resourceId: connectionId });
}

export async function listBankConnections(db: DBOrTx, ctx: Ctx) {
  return db.select().from(schema.bankConnections).where(and(eq(schema.bankConnections.ownerUserId, ctx.userId), isNull(schema.bankConnections.revokedAt)));
}

export async function listPaymentOrders(db: DBOrTx, ctx: Ctx) {
  return db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.ownerUserId, ctx.userId)).orderBy(desc(schema.paymentOrders.createdAt)).limit(50);
}

/**
 * État rapporté par le prestataire (webhook ou rapprochement). Une banque peut annoncer directement
 * « exécuté » après l'autorisation forte : l'ordre passe alors par « soumis » pour rester dans
 * l'automate, chaque étape étant tracée.
 */
async function applyProviderState(tx: DBOrTx, order: typeof schema.paymentOrders.$inferSelect, to: PaymentState) {
  if (!canTransition(order.state, to) && order.state === "to_authorize" && canTransition("submitted", to)) {
    order = await setOrderState(tx, order, "submitted", { submittedAt: order.submittedAt ?? new Date() });
  }
  return setOrderState(tx, order, to);
}

async function setOrderState(tx: DBOrTx, order: typeof schema.paymentOrders.$inferSelect, to: PaymentState, extra: Partial<typeof schema.paymentOrders.$inferInsert> = {}) {
  assertTransition(order.state, to);
  const [row] = await tx
    .update(schema.paymentOrders)
    .set({ state: to, updatedAt: new Date(), version: order.version + 1, resolvedAt: ["confirmed", "failed", "cancelled"].includes(to) ? new Date() : null, ...extra })
    .where(and(eq(schema.paymentOrders.id, order.id), eq(schema.paymentOrders.version, order.version)))
    .returning();
  if (!row) throw new AppError("VERSION_CONFLICT", "Ordre modifié en parallèle.");
  if (to === "confirmed") {
    // Une seule entrée d'épargne confirmée par ordre (index unique) : rejeu sans effet (cas F).
    await tx
      .insert(schema.savingsEntries)
      .values({ ownerUserId: row.ownerUserId, projectId: row.projectId, kind: "bank_confirmed", amount: row.amount, occurredOn: new Date().toISOString().slice(0, 10), paymentOrderId: row.id, provenance: `Confirmation ${row.providerOrderRef ?? ""}`.trim() })
      .onConflictDoNothing({ target: schema.savingsEntries.paymentOrderId });
    await notify(tx, row.ownerUserId, { kind: "epargne", title: "Virement confirmé", body: `Votre virement de ${formatMoney(row.amount)} a été confirmé par la banque.`, link: "/projets", dedupeKey: `payment-confirmed:${row.id}` });
  }
  return row;
}

/**
 * Prépare un ordre (brouillon) après vérifications serveur : connexion valide, capacité,
 * plafond, règle non suspendue, et aucune tentative incertaine en cours.
 * La même clé d'idempotence renvoie toujours le même ordre.
 */
export async function preparePaymentOrder(db: DB, ctx: Ctx, input: { projectId: string; amount: string; bankConnectionId: string; idempotencyKey: string }) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw validation("Clé d'idempotence requise.");
  const amount = D(input.amount.replace(",", "."));
  if (amount.lte(0)) throw validation("Montant invalide.");
  return db.transaction(async (tx) => {
    await lockUser(tx, ctx.userId);
    const [existing] = await tx.select().from(schema.paymentOrders).where(and(eq(schema.paymentOrders.ownerUserId, ctx.userId), eq(schema.paymentOrders.idempotencyKey, input.idempotencyKey)));
    if (existing) return existing;
    const [open] = await tx.select().from(schema.paymentOrders).where(and(eq(schema.paymentOrders.ownerUserId, ctx.userId), inArray(schema.paymentOrders.state, IN_FLIGHT_STATES)));
    if (open) throw new AppError("PAYMENT_IN_PROGRESS", "Un virement est déjà en cours ou au statut incertain : il doit être résolu avant tout nouvel ordre.", { orderId: open.id, state: open.state });
    const [conn] = await tx.select().from(schema.bankConnections).where(eq(schema.bankConnections.id, input.bankConnectionId));
    if (!conn || conn.ownerUserId !== ctx.userId || conn.revokedAt) throw notFound("Connexion bancaire introuvable.");
    if (!conn.canInitiatePayments) throw validation("Cette connexion ne permet pas d'initier des virements.");
    if (!conn.ownershipVerified) throw validation("Le compte de destination n'est pas vérifié comme vous appartenant.");
    if (conn.environment === "production" && env.bankEnvironment !== "production") throw new AppError("NOT_CONNECTED", "Production bancaire non activée.");
    const [rule] = await tx.select().from(schema.savingsRules).where(eq(schema.savingsRules.ownerUserId, ctx.userId));
    if (rule?.stoppedAt) throw validation("L'épargne est arrêtée : réactivez-la avant tout virement.");
    if (rule?.pausedAt) throw validation("L'épargne est en pause.");
    if (rule?.capAmount) {
      const [{ month }] = await tx.select({ month: sql<string>`coalesce(sum(${schema.paymentOrders.amount}),0)` }).from(schema.paymentOrders).where(and(eq(schema.paymentOrders.ownerUserId, ctx.userId), inArray(schema.paymentOrders.state, ["confirmed", ...IN_FLIGHT_STATES]), sql`${schema.paymentOrders.createdAt} >= date_trunc('month', now())`));
      if (D(month).plus(amount).gt(rule.capAmount)) throw validation(`Plafond mensuel de ${formatMoney(rule.capAmount)} atteint.`);
    }
    const [view] = await projectFigures(tx, ctx, [input.projectId]);
    if (!view) throw notFound("Projet introuvable.");
    if (amount.gt(view.transferable)) throw validation(`Le montant dépasse ce qui reste à verser pour ce projet (${formatMoney(view.transferable)}).`);
    const [order] = await tx
      .insert(schema.paymentOrders)
      .values({ ownerUserId: ctx.userId, projectId: input.projectId, bankConnectionId: conn.id, amount: toDb(amount, 4), idempotencyKey: input.idempotencyKey, state: "draft", feesNotice: "Frais éventuels : dépendent de votre banque et du prestataire. Bac à sable : aucun frais." })
      .returning();
    await audit(tx, { actorUserId: ctx.userId, action: "payment.prepare", resourceType: "payment_order", resourceId: order.id, details: { amount: order.amount } });
    return order;
  });
}

/** Consentement explicite après récapitulatif → envoi au prestataire. Timeout → statut inconnu. */
export async function submitPaymentOrder(db: DB, ctx: Ctx, orderId: string, opts: { consent: boolean; scenario?: "ok" | "timeout" | "fail" }) {
  if (!opts.consent) throw validation("Le consentement explicite est requis.");
  const [order] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, orderId));
  if (!order || order.ownerUserId !== ctx.userId) throw notFound("Ordre introuvable.");
  if (order.state !== "draft") return order;
  const [conn] = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.id, order.bankConnectionId));
  const provider = bankProvider();
  await audit(db, { actorUserId: ctx.userId, action: "payment.consent", resourceType: "payment_order", resourceId: order.id });
  try {
    const res = await provider.initiatePayment(db, { connectionRef: conn.providerConnectionRef, amount: order.amount, currency: order.currency, idempotencyKey: order.idempotencyKey, reference: `KIVMO ${order.id.slice(0, 8)}`, scenario: provider.environment === "sandbox" ? opts.scenario : undefined });
    return db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, orderId));
      return setOrderState(tx, fresh, res.state, { providerOrderRef: res.providerOrderRef, authorizationUrl: res.authorizationUrl, feesNotice: res.feesNotice, submittedAt: new Date() });
    });
  } catch (e) {
    if (e instanceof ProviderTimeoutError) {
      return db.transaction(async (tx) => {
        const [fresh] = await tx.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, orderId));
        const ref = await findSandboxRef(tx, fresh.idempotencyKey);
        return setOrderState(tx, fresh, "unknown", { lastError: "Délai de réponse dépassé : statut à rapprocher.", providerOrderRef: ref, submittedAt: new Date() });
      });
    }
    throw e;
  }
}

async function findSandboxRef(tx: DBOrTx, idem: string) {
  const [p] = await tx.select().from(schema.sandboxBankPayments).where(eq(schema.sandboxBankPayments.idempotencyKey, idem));
  return p?.providerRef ?? null;
}

export async function cancelPaymentOrder(db: DB, ctx: Ctx, orderId: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, orderId));
    if (!order || order.ownerUserId !== ctx.userId) throw notFound("Ordre introuvable.");
    if (!["draft", "to_authorize"].includes(order.state)) throw validation("Cet ordre ne peut plus être annulé depuis KIVMO.");
    return setOrderState(tx, order, "cancelled");
  });
}

/** Rapprochement : interroge le prestataire pour les ordres incertains ou en attente. */
export async function reconcilePaymentOrders(db: DB, ownerUserId?: string) {
  const provider = bankProvider();
  const orders = await db.select().from(schema.paymentOrders).where(and(inArray(schema.paymentOrders.state, ["unknown", "submitted", "pending", "to_authorize"]), ownerUserId ? eq(schema.paymentOrders.ownerUserId, ownerUserId) : undefined));
  const results: { id: string; from: PaymentState; to: PaymentState }[] = [];
  for (const o of orders) {
    if (!o.providerOrderRef) continue;
    const status = await provider.getPaymentStatus(db, o.providerOrderRef);
    if (status === o.state || status === "unknown") continue;
    if (o.state === "unknown" && status === "to_authorize") continue;
    await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, o.id));
      if (fresh.state === status) return;
      await applyProviderState(tx, fresh, status);
      results.push({ id: o.id, from: o.state, to: status });
    });
  }
  return results;
}

/**
 * Webhook prestataire : signature vérifiée, fenêtre anti-rejeu, idempotence par identifiant
 * d'événement (cas F). Retourne "duplicate" si l'événement a déjà été traité.
 */
export async function handleBankWebhook(db: DB, rawBody: string, headers: { signature: string | null; timestamp: string | null }, now = Date.now()) {
  const ts = Number(headers.timestamp);
  if (!headers.signature || !Number.isFinite(ts)) throw new AppError("FORBIDDEN", "Signature absente.");
  if (Math.abs(now / 1000 - ts) > 300) throw new AppError("FORBIDDEN", "Horodatage hors fenêtre (rejeu possible).");
  const expected = signWebhook(rawBody, ts);
  if (!safeEqual(expected, headers.signature)) throw new AppError("FORBIDDEN", "Signature invalide.");
  const payload = JSON.parse(rawBody) as { id: string; type: string; data: { providerOrderRef: string; state: PaymentState } };
  if (!payload.id || !payload.data?.providerOrderRef) throw validation("Événement invalide.");
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.paymentEvents)
      .values({ provider: SANDBOX_PROVIDER, providerEventId: payload.id, type: payload.type, payload, signatureValid: true })
      .onConflictDoNothing({ target: [schema.paymentEvents.provider, schema.paymentEvents.providerEventId] })
      .returning();
    if (!inserted.length) return { result: "duplicate" as const };
    const [order] = await tx.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.providerOrderRef, payload.data.providerOrderRef));
    if (!order) return { result: "unknown_order" as const };
    await tx.update(schema.paymentEvents).set({ paymentOrderId: order.id, processedAt: new Date() }).where(eq(schema.paymentEvents.id, inserted[0].id));
    if (order.state === payload.data.state) return { result: "noop" as const };
    const row = await applyProviderState(tx, order, payload.data.state);
    return { result: "applied" as const, state: row.state };
  });
}

/* ───────── Règle d'épargne (fréquence, seuil, plafond, pause, arrêt) ───────── */

export async function upsertSavingsRule(db: DB, ctx: Ctx, input: { mode: "manuel" | "prepare" | "automatique"; frequency: string; minimumAmount: string; capAmount?: string | null; bankConnectionId?: string | null }) {
  if (input.mode === "automatique") throw new AppError("NOT_CONNECTED", "Épargne automatique indisponible : elle exige un prestataire et une banque qui permettent ce mécanisme.");
  const [existing] = await db.select().from(schema.savingsRules).where(eq(schema.savingsRules.ownerUserId, ctx.userId));
  const values = { mode: input.mode, frequency: input.frequency, minimumAmount: input.minimumAmount, capAmount: input.capAmount || null, bankConnectionId: input.bankConnectionId ?? null };
  if (existing) await db.update(schema.savingsRules).set({ ...values, updatedAt: new Date(), version: existing.version + 1 }).where(eq(schema.savingsRules.id, existing.id));
  else await db.insert(schema.savingsRules).values({ ownerUserId: ctx.userId, ...values });
  await audit(db, { actorUserId: ctx.userId, action: "savings.rule", resourceType: "savings_rule", details: values });
}

export async function setSavingsRuleState(db: DB, ctx: Ctx, state: "pause" | "reprise" | "arret") {
  const [r] = await db.select().from(schema.savingsRules).where(eq(schema.savingsRules.ownerUserId, ctx.userId));
  if (!r) {
    await db.insert(schema.savingsRules).values({ ownerUserId: ctx.userId, pausedAt: state === "pause" ? new Date() : null, stoppedAt: state === "arret" ? new Date() : null });
    return;
  }
  await db.update(schema.savingsRules).set({ pausedAt: state === "pause" ? new Date() : null, stoppedAt: state === "arret" ? new Date() : null, updatedAt: new Date() }).where(eq(schema.savingsRules.id, r.id));
  await audit(db, { actorUserId: ctx.userId, action: `savings.${state}`, resourceType: "savings_rule", resourceId: r.id });
}

export async function getSavingsRule(db: DBOrTx, ctx: Ctx) {
  const [r] = await db.select().from(schema.savingsRules).where(eq(schema.savingsRules.ownerUserId, ctx.userId));
  return r ?? null;
}

export { ZERO };
