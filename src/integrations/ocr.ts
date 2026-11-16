import { env } from "@/server/env";

/**
 * Contrat OCR (ticket et compteur). Chaque champ porte une confiance ; la confirmation par
 * l'utilisateur est obligatoire avant enregistrement (§6). Aucun prestataire n'est branché par
 * défaut : coût, confidentialité, rétention et qualité restent à valider.
 */
export interface OcrField<T> {
  value: T | null;
  confidence: number; // 0–1
}

export interface ReceiptExtraction {
  date: OcrField<string>;
  liters: OcrField<string>;
  unitPrice: OcrField<string>;
  total: OcrField<string>;
  fuel: OcrField<string>;
  stationName: OcrField<string>;
}

export interface OcrProvider {
  name: string;
  extractReceipt(image: Buffer, mimeType: string): Promise<ReceiptExtraction>;
  extractOdometer(image: Buffer, mimeType: string): Promise<OcrField<string>>;
}

export function ocrProvider(): OcrProvider | null {
  if (!env.ocrProvider) return null;
  // Point d'intégration : instancier ici le client du prestataire retenu (OCR_PROVIDER, OCR_API_KEY).
  return null;
}

export const OCR_UNAVAILABLE_MESSAGE = "Lecture automatique à connecter : le ticket est conservé en privé, complétez le formulaire.";
