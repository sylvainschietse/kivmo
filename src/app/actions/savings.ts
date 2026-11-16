"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { runAction, str, optStr } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import {
  allocateAvailableGains, archiveProject, cancelPaymentOrder, connectBank, createProject, declareManualTransfer,
  preparePaymentOrder, reconcilePaymentOrders, revokeBank, setSavingsRuleState, submitPaymentOrder, updateProjectShares, upsertSavingsRule, handleBankWebhook,
} from "@/server/services/savings";
import { signWebhook } from "@/integrations/bank";
import { formatMoney } from "@/lib/format";

const ok = (path: string, msg: string) => `${path}?ok=${encodeURIComponent(msg)}`;

export async function createProjectAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets", async () => {
    await createProject(getDb(), ctx, {
      name: str(fd, "name"),
      emoji: optStr(fd, "emoji"),
      target: optStr(fd, "target"),
      targetDate: optStr(fd, "targetDate"),
      priority: Number(str(fd, "priority") || 1),
      sharePercent: optStr(fd, "sharePercent"),
      shareFixedAmount: optStr(fd, "shareFixedAmount"),
    });
    revalidatePath("/projets");
    return ok("/projets", "Projet créé.");
  });
}

export async function updateSharesAction(fd: FormData) {
  const { ctx } = await requireSession();
  const ids = fd.getAll("projectId").map(String);
  await runAction("/projets", async () => {
    await updateProjectShares(getDb(), ctx, ids.map((id) => ({ projectId: id, sharePercent: optStr(fd, `pct-${id}`)?.replace(",", ".") ?? null, shareFixedAmount: optStr(fd, `fix-${id}`)?.replace(",", ".") ?? null })));
    return ok("/projets", "Répartition enregistrée.");
  });
}

export async function archiveProjectAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets", async () => {
    await archiveProject(getDb(), ctx, str(fd, "projectId"));
    return ok("/projets", "Projet archivé.");
  });
}

export async function allocateAction() {
  const { ctx } = await requireSession();
  await runAction("/projets", async () => {
    const r = await allocateAvailableGains(getDb(), ctx);
    const total = r.lines.reduce((a, l) => a + Number(l.amount), 0);
    return ok("/projets", r.lines.length ? `${formatMoney(total)} affectés à vos projets (affectation logique, aucun argent déplacé).` : r.capacity.message);
  });
}

export async function declareTransferAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets", async () => {
    await declareManualTransfer(getDb(), ctx, { projectId: str(fd, "projectId"), amount: str(fd, "amount"), occurredOn: str(fd, "occurredOn"), note: optStr(fd, "note") ?? undefined });
    return ok("/projets", "Virement déclaré (déclaration manuelle, non vérifiée par une banque).");
  });
}

export async function connectBankAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    if (str(fd, "consent") !== "1") throw new AppError("VALIDATION", "Cochez le consentement pour continuer.");
    await connectBank(getDb(), ctx, str(fd, "consentVersion") || "2026-11");
    return ok("/projets/epargne", "Banque de démonstration connectée (bac à sable).");
  });
}

export async function revokeBankAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    await revokeBank(getDb(), ctx, str(fd, "connectionId"));
    return ok("/projets/epargne", "Connexion bancaire révoquée.");
  });
}

export async function prepareOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    await preparePaymentOrder(getDb(), ctx, { projectId: str(fd, "projectId"), amount: str(fd, "amount"), bankConnectionId: str(fd, "bankConnectionId"), idempotencyKey: str(fd, "idempotencyKey") || crypto.randomUUID() });
    return ok("/projets/epargne", "Ordre préparé : vérifiez-le puis soumettez-le.");
  });
}

export async function submitOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    const scenario = (str(fd, "scenario") || "ok") as "ok" | "timeout" | "fail";
    const o = await submitPaymentOrder(getDb(), ctx, str(fd, "orderId"), { consent: str(fd, "consent") === "1", scenario });
    if (o.state === "to_authorize" && o.authorizationUrl) return o.authorizationUrl;
    return ok("/projets/epargne", o.state === "unknown" ? "Réponse de la banque incertaine : l'ordre est bloqué jusqu'au rapprochement, aucun nouvel ordre ne sera créé." : "Ordre soumis.");
  });
}

export async function cancelOrderAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    await cancelPaymentOrder(getDb(), ctx, str(fd, "orderId"));
    return ok("/projets/epargne", "Ordre annulé.");
  });
}

export async function reconcileAction() {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    const r = await reconcilePaymentOrders(getDb(), ctx.userId);
    return ok("/projets/epargne", r.length ? `${r.length} ordre(s) mis à jour.` : "Aucun changement côté banque.");
  });
}

export async function savingsRuleAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    await upsertSavingsRule(getDb(), ctx, { mode: str(fd, "mode") as "manuel", frequency: str(fd, "frequency"), minimumAmount: str(fd, "minimumAmount").replace(",", ".") || "10", capAmount: optStr(fd, "capAmount")?.replace(",", ".") ?? null, bankConnectionId: optStr(fd, "bankConnectionId") });
    return ok("/projets/epargne", "Règle enregistrée.");
  });
}

export async function savingsRuleStateAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/projets/epargne", async () => {
    const s = str(fd, "state") as "pause" | "reprise" | "arret";
    await setSavingsRuleState(getDb(), ctx, s);
    return ok("/projets/epargne", s === "pause" ? "Règle en pause." : s === "reprise" ? "Règle reprise." : "Règle arrêtée.");
  });
}

/**
 * Page d'autorisation du bac à sable : simule la banque. La décision met à jour le paiement
 * fictif puis émet un webhook signé, traité par le même code que le vrai webhook.
 */
export async function sandboxAuthorizeAction(fd: FormData) {
  const { ctx } = await requireSession();
  const ref = str(fd, "ref");
  const back = `/projets/epargne/bac-a-sable?ref=${encodeURIComponent(ref)}`;
  await runAction(back, async () => {
    const db = getDb();
    const [order] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.providerOrderRef, ref));
    if (!order || order.ownerUserId !== ctx.userId) throw notFound("Ordre introuvable.");
    const decision = str(fd, "decision") === "accept" ? "confirmed" : "failed";
    await db.update(schema.sandboxBankPayments).set({ state: decision, updatedAt: new Date() }).where(eq(schema.sandboxBankPayments.providerRef, ref));
    const body = JSON.stringify({ id: `sbx_evt_${crypto.randomUUID()}`, type: "payment.updated", data: { providerOrderRef: ref, state: decision } });
    const ts = Math.floor(Date.now() / 1000);
    await handleBankWebhook(db, body, { signature: signWebhook(body, ts), timestamp: String(ts) });
    return ok("/projets/epargne", decision === "confirmed" ? "Virement fictif confirmé par la banque de démonstration." : "Virement fictif refusé.");
  });
}
