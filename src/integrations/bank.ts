import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DBOrTx } from "@/db/client";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import type { PaymentState } from "@/domain/payment-state";

/**
 * Contrat d'intégration bancaire (§10). L'accès aux transactions et l'initiation de paiement
 * sont des capacités distinctes. Aucune donnée d'authentification bancaire ne transite par KIVMO.
 */
export interface BankConnectionResult {
  connectionRef: string;
  accountLabel: string;
  ibanMasked: string;
  ownershipVerified: boolean;
  canReadTransactions: boolean;
  canInitiatePayments: boolean;
  consentExpiresAt: Date | null;
}

export interface InitiatePaymentInput {
  connectionRef: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
  reference: string;
  /** Bac à sable uniquement : scénario simulé. */
  scenario?: "ok" | "timeout" | "fail";
}

export interface InitiatePaymentResult {
  providerOrderRef: string;
  state: Extract<PaymentState, "to_authorize" | "submitted">;
  authorizationUrl: string | null;
  feesNotice: string;
}

export interface BankProvider {
  name: string;
  environment: "sandbox" | "production";
  connect(userId: string): Promise<BankConnectionResult>;
  initiatePayment(db: DBOrTx, input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  getPaymentStatus(db: DBOrTx, providerOrderRef: string): Promise<PaymentState>;
  revoke(connectionRef: string): Promise<void>;
}

export class ProviderTimeoutError extends Error {}

/** Signature des webhooks : HMAC-SHA256 de `${timestamp}.${corps}` ; fenêtre anti-rejeu de 5 minutes. */
export function signWebhook(body: string, timestamp: number, secret = env.bankWebhookSecret) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export const SANDBOX_PROVIDER = "kivmo-sandbox";

export const sandboxProvider: BankProvider = {
  name: SANDBOX_PROVIDER,
  environment: "sandbox",
  async connect(userId) {
    return {
      connectionRef: `sbx_conn_${userId.slice(0, 8)}_${Date.now().toString(36)}`,
      accountLabel: "Compte épargne fictif (bac à sable)",
      ibanMasked: "FR76 •••• •••• •••• •••• •••• 042",
      ownershipVerified: true,
      canReadTransactions: false,
      canInitiatePayments: true,
      consentExpiresAt: new Date(Date.now() + 90 * 86_400_000),
    };
  },
  async initiatePayment(db, input) {
    const [existing] = await db.select().from(schema.sandboxBankPayments).where(eq(schema.sandboxBankPayments.idempotencyKey, input.idempotencyKey));
    const ref = existing?.providerRef ?? `sbx_pay_${input.idempotencyKey.slice(0, 12)}_${Date.now().toString(36)}`;
    if (!existing) {
      await db.insert(schema.sandboxBankPayments).values({ providerRef: ref, state: input.scenario === "fail" ? "failed" : "to_authorize", amount: input.amount, idempotencyKey: input.idempotencyKey });
    }
    if (input.scenario === "timeout") throw new ProviderTimeoutError("Délai dépassé (simulation).");
    return {
      providerOrderRef: ref,
      state: "to_authorize",
      authorizationUrl: `/projets/epargne/bac-a-sable?ref=${encodeURIComponent(ref)}`,
      feesNotice: "Bac à sable : aucun frais. En production, les frais éventuels dépendent de votre banque et du prestataire ; ils seront affichés avant consentement.",
    };
  },
  async getPaymentStatus(db, ref) {
    const [p] = await db.select().from(schema.sandboxBankPayments).where(eq(schema.sandboxBankPayments.providerRef, ref));
    return p?.state ?? "unknown";
  },
  async revoke() {},
};

export function bankProvider(): BankProvider {
  if (env.bankEnvironment === "production") {
    // Aucun prestataire de production n'est intégré : il doit être sélectionné après validation
    // réelle des pays, banques, paiements et automatisations supportés (§15, §16).
    throw new AppError("NOT_CONNECTED", "Virements bancaires réels non activés : prestataire à connecter et capacités à vérifier.");
  }
  return sandboxProvider;
}
