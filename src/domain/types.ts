import type { Decimal } from "@/lib/decimal";

export const FUELS = ["E85", "SP95", "SP95_E10", "SP98", "GAZOLE", "GPL", "ELEC_KWH"] as const;
export type FuelCode = (typeof FUELS)[number];

export const FUEL_LABELS: Record<FuelCode, string> = {
  E85: "E85 (superéthanol)",
  SP95: "SP95",
  SP95_E10: "SP95-E10",
  SP98: "SP98",
  GAZOLE: "Gazole",
  GPL: "GPL",
  ELEC_KWH: "Électricité (kWh)",
};

export interface FillupLineInput {
  fuel: FuelCode;
  liters: Decimal;
  /** Montant réellement payé pour la ligne (le ticket fait foi). */
  amountPaid: Decimal;
}

export interface ReferencePriceSnapshot {
  fuel: FuelCode;
  price: Decimal;
  source: string;
  observedAt: Date | null;
}

export interface FillupInput {
  id: string;
  occurredAt: Date;
  /** Compteur normalisé (relevé + décalages historisés d'un compteur remplacé). */
  odometerKm: Decimal;
  isFull: boolean;
  /** L'utilisateur a choisi de repartir d'un nouveau repère complet. */
  startsNewBaseline?: boolean;
  /** L'utilisateur a déclaré avoir oublié de saisir un achat avant celui-ci. */
  missedBefore?: boolean;
  lines: FillupLineInput[];
  referencePrice?: ReferencePriceSnapshot | null;
}
