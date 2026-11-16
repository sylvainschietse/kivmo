import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, daysAgo, expectCode } from "./helpers";
import { schema } from "@/db/client";
import { createVehicle, addReferenceProfile } from "@/server/services/vehicles";
import { createFillup } from "@/server/services/fillups";
import {
  allocateAvailableGains,
  connectBank,
  createProject,
  declareManualTransfer,
  handleBankWebhook,
  preparePaymentOrder,
  projectFigures,
  reconcilePaymentOrders,
  savingsOverview,
  submitPaymentOrder,
  setSavingsRuleState,
  upsertSavingsRule,
} from "@/server/services/savings";
import { signWebhook } from "@/integrations/bank";

/** Utilisateur avec un gain mesuré de 50 € exactement. */
async function userWithGain50() {
  const u = await makeUser("epargnant");
  const v = await createVehicle(db(), u, { name: "V", energy: "e85_conversion" });
  // Référence : 600 km × 6/100 × 2,50 = 90 € ; achats 40 € → gain 50 €.
  await addReferenceProfile(db(), u, v.id, { kind: "scenario_libre", label: "Réf", fuel: "GAZOLE", consumptionL100: "6", priceMode: "fixed", fixedPrice: "2.5", effectiveFrom: daysAgo(90) });
  await createFillup(db(), u, { vehicleId: v.id, occurredAt: daysAgo(40), odometerKm: "10000", isFull: true, lines: [{ fuel: "E85", liters: "40", amount: "36" }] }, "a");
  await createFillup(db(), u, { vehicleId: v.id, occurredAt: daysAgo(30), odometerKm: "10600", isFull: true, lines: [{ fuel: "E85", liters: "45", amount: "40" }] }, "b");
  return { u, v };
}

describe("H — répartition 60/40 et perte ultérieure", () => {
  it("affecte 30/20 puis réduit la capacité sans reprendre d'argent", async () => {
    const { u, v } = await userWithGain50();
    const ov = await savingsOverview(db(), u);
    expect(ov.gains.calculatedGains.toString()).toBe("50");
    const A = await createProject(db(), u, { name: "A", sharePercent: "60" });
    const B = await createProject(db(), u, { name: "B", sharePercent: "40" });
    const res = await allocateAvailableGains(db(), u);
    const byP = Object.fromEntries(res.lines.map((l) => [l.projectId, l.amount.toString()]));
    expect(byP[A.id]).toBe("30");
    expect(byP[B.id]).toBe("20");
    // Deuxième appel : rien à réaffecter (aucune double affectation)
    const again = await allocateAvailableGains(db(), u);
    expect(again.lines).toHaveLength(0);
    await declareManualTransfer(db(), u, { projectId: A.id, amount: "30", occurredOn: "2026-11-01" });
    // Perte suivante de 10 € : prix de référence plus bas sur un nouvel intervalle
    await createFillup(db(), u, { vehicleId: v.id, occurredAt: daysAgo(20), odometerKm: "11200", isFull: true, lines: [{ fuel: "E85", liters: "45", amount: "100" }], confirmIssues: true }, "c");
    const ov2 = await savingsOverview(db(), u);
    expect(ov2.capacity.capacity.toString()).toBe("0");
    expect(ov2.capacity.deficit.toDecimalPlaces(2).toString()).toBe("10");
    const figs = await projectFigures(db(), u);
    const fa = figs.find((f) => f.project.id === A.id)!;
    expect(fa.figures.declaredManual.toString()).toBe("30");
    expect(fa.figures.allocated.toString()).toBe("30");
    await expectCode(declareManualTransfer(db(), u, { projectId: A.id, amount: "1", occurredOn: "2026-11-02" }), "VALIDATION");
  });
});

async function userReadyToPay() {
  const { u } = await userWithGain50();
  const p = await createProject(db(), u, { name: "Voyage", sharePercent: "100" });
  await allocateAvailableGains(db(), u);
  const conn = await connectBank(db(), u, "banque-2026-11");
  return { u, p, conn };
}

function signed(body: object, ts = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(body);
  return { raw, headers: { signature: signWebhook(raw, ts), timestamp: String(ts) } };
}

describe("F — confirmation bancaire et timeout", () => {
  it("timeout puis webhook : un seul ordre, une seule entrée d'épargne", async () => {
    const { u, p, conn } = await userReadyToPay();
    const order = await preparePaymentOrder(db(), u, { projectId: p.id, amount: "20", bankConnectionId: conn.id, idempotencyKey: "pay-key-0001" });
    expect(order.state).toBe("draft");
    await expectCode(submitPaymentOrder(db(), u, order.id, { consent: false }), "VALIDATION");
    const afterTimeout = await submitPaymentOrder(db(), u, order.id, { consent: true, scenario: "timeout" });
    expect(afterTimeout.state).toBe("unknown");
    // Réessai avec la même clé : même ordre ; nouvelle clé : refus tant que le statut est incertain.
    const same = await preparePaymentOrder(db(), u, { projectId: p.id, amount: "20", bankConnectionId: conn.id, idempotencyKey: "pay-key-0001" });
    expect(same.id).toBe(order.id);
    await expectCode(preparePaymentOrder(db(), u, { projectId: p.id, amount: "5", bankConnectionId: conn.id, idempotencyKey: "pay-key-0002" }), "PAYMENT_IN_PROGRESS");
    const event = { id: "evt_1", type: "payment.updated", data: { providerOrderRef: afterTimeout.providerOrderRef!, state: "confirmed" } };
    const w1 = signed(event);
    expect((await handleBankWebhook(db(), w1.raw, w1.headers)).result).toBe("applied");
    const w2 = signed(event);
    expect((await handleBankWebhook(db(), w2.raw, w2.headers)).result).toBe("duplicate");
    const w3 = signed({ ...event, id: "evt_2" });
    expect((await handleBankWebhook(db(), w3.raw, w3.headers)).result).toBe("noop");
    const entries = await db().select().from(schema.savingsEntries).where(eq(schema.savingsEntries.paymentOrderId, order.id));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("bank_confirmed");
    const figs = await projectFigures(db(), u, [p.id]);
    expect(figs[0].figures.bankConfirmed.toString()).toBe("20");
    expect(figs[0].figures.inFlight.toString()).toBe("0");
    // Nouvel ordre possible une fois le statut résolu
    const next = await preparePaymentOrder(db(), u, { projectId: p.id, amount: "5", bankConnectionId: conn.id, idempotencyKey: "pay-key-0003" });
    expect(next.state).toBe("draft");
  });

  it("autorisation forte puis exécution annoncée directement : l'ordre passe par « soumis » et confirme une fois", async () => {
    const { u, p, conn } = await userReadyToPay();
    const order = await preparePaymentOrder(db(), u, { projectId: p.id, amount: "10", bankConnectionId: conn.id, idempotencyKey: "pay-key-sca-1" });
    const sub = await submitPaymentOrder(db(), u, order.id, { consent: true, scenario: "ok" });
    expect(sub.state).toBe("to_authorize");
    const w = signed({ id: "evt_sca_1", type: "payment.updated", data: { providerOrderRef: sub.providerOrderRef!, state: "confirmed" } });
    expect((await handleBankWebhook(db(), w.raw, w.headers)).result).toBe("applied");
    const [row] = await db().select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, order.id));
    expect(row.state).toBe("confirmed");
    expect(row.submittedAt).not.toBeNull();
    const entries = await db().select().from(schema.savingsEntries).where(eq(schema.savingsEntries.paymentOrderId, order.id));
    expect(entries).toHaveLength(1);
  });

  it("webhook non signé, mal signé ou rejoué hors fenêtre : refusé", async () => {
    const body = JSON.stringify({ id: "evt_x", type: "t", data: { providerOrderRef: "x", state: "confirmed" } });
    await expectCode(handleBankWebhook(db(), body, { signature: null, timestamp: null }), "FORBIDDEN");
    await expectCode(handleBankWebhook(db(), body, { signature: "deadbeef", timestamp: String(Math.floor(Date.now() / 1000)) }), "FORBIDDEN");
    const old = Math.floor(Date.now() / 1000) - 3600;
    await expectCode(handleBankWebhook(db(), body, { signature: signWebhook(body, old), timestamp: String(old) }), "FORBIDDEN");
  });

  it("rapprochement : un statut inconnu se résout par interrogation du prestataire", async () => {
    const { u, p, conn } = await userReadyToPay();
    const order = await preparePaymentOrder(db(), u, { projectId: p.id, amount: "10", bankConnectionId: conn.id, idempotencyKey: "pay-key-r001" });
    const unk = await submitPaymentOrder(db(), u, order.id, { consent: true, scenario: "timeout" });
    await db().update(schema.sandboxBankPayments).set({ state: "failed" }).where(eq(schema.sandboxBankPayments.providerRef, unk.providerOrderRef!));
    const res = await reconcilePaymentOrders(db(), u.userId);
    expect(res[0]).toMatchObject({ from: "unknown", to: "failed" });
    const entries = await db().select().from(schema.savingsEntries).where(eq(schema.savingsEntries.paymentOrderId, order.id));
    expect(entries).toHaveLength(0);
  });

  it("plafond, pause, arrêt et doublons manuel/automatique vérifiés côté serveur", async () => {
    const { u, p, conn } = await userReadyToPay();
    await upsertSavingsRule(db(), u, { mode: "prepare", frequency: "mensuelle", minimumAmount: "5", capAmount: "15" });
    await expectCode(preparePaymentOrder(db(), u, { projectId: p.id, amount: "20", bankConnectionId: conn.id, idempotencyKey: "cap-key-0001" }), "VALIDATION");
    await setSavingsRuleState(db(), u, "pause");
    await expectCode(preparePaymentOrder(db(), u, { projectId: p.id, amount: "10", bankConnectionId: conn.id, idempotencyKey: "cap-key-0002" }), "VALIDATION");
    await setSavingsRuleState(db(), u, "reprise");
    await preparePaymentOrder(db(), u, { projectId: p.id, amount: "10", bankConnectionId: conn.id, idempotencyKey: "cap-key-0003" });
    // 50 affectés − 10 en vol = 40 versables : une déclaration manuelle de 45 est refusée
    await expectCode(declareManualTransfer(db(), u, { projectId: p.id, amount: "45", occurredOn: "2026-11-10" }), "VALIDATION");
    await declareManualTransfer(db(), u, { projectId: p.id, amount: "40", occurredOn: "2026-11-10" });
    await expectCode(upsertSavingsRule(db(), u, { mode: "automatique", frequency: "mensuelle", minimumAmount: "5" }), "NOT_CONNECTED");
  });
});
