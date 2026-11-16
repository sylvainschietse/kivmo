/**
 * §10 — Machine d'états des ordres de virement.
 * Aucun nouvel ordre tant qu'une tentative au statut incertain n'est pas résolue.
 */
export const PAYMENT_STATES = [
  "draft",
  "to_authorize",
  "submitted",
  "pending",
  "confirmed",
  "failed",
  "cancelled",
  "unknown",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  draft: "Brouillon",
  to_authorize: "À autoriser",
  submitted: "Soumis",
  pending: "Virement en attente de confirmation",
  confirmed: "Confirmé par la banque",
  failed: "Échoué",
  cancelled: "Annulé",
  unknown: "Statut inconnu — rapprochement en cours",
};

const TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  draft: ["to_authorize", "submitted", "unknown", "failed", "cancelled"],
  to_authorize: ["submitted", "cancelled", "failed", "unknown"],
  submitted: ["pending", "confirmed", "failed", "unknown"],
  pending: ["confirmed", "failed", "unknown", "cancelled"],
  unknown: ["pending", "confirmed", "failed", "cancelled"],
  confirmed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) throw new Error(`Transition interdite : ${from} → ${to}`);
}

/** États qui bloquent la création d'un nouvel ordre (tentative en cours ou incertaine). */
export const BLOCKING_STATES: PaymentState[] = ["to_authorize", "submitted", "pending", "unknown"];
export const TERMINAL_STATES: PaymentState[] = ["confirmed", "failed", "cancelled"];
/** Montants « en vol » : réservés tant que l'ordre n'est pas terminé. */
export const IN_FLIGHT_STATES: PaymentState[] = ["draft", "to_authorize", "submitted", "pending", "unknown"];
