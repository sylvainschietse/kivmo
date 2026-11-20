import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/server/env";

/**
 * Lecture automatique de photos (compteur, écran de pompe, ticket, carte grise, plaque) par le
 * service de vision Claude (Anthropic). Les valeurs lues ne sont que des PROPOSITIONS : elles
 * pré-remplissent le formulaire et l'utilisateur vérifie avant d'enregistrer (§6).
 * Les photos envoyées pour lecture ne sont pas conservées par KIVMO.
 * Activation : variable ANTHROPIC_API_KEY (modèle réglable par OCR_MODEL).
 */

export type ScanImage = { data: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp" };

const FUEL_CODES = ["E85", "SP95", "SP95_E10", "SP98", "GAZOLE", "GPL", "ELEC_KWH"] as const;
const ENERGY_CODES = ["essence", "diesel", "e85_flex", "e85_conversion", "gpl", "hybride", "hybride_rechargeable", "electrique"] as const;

const confidence = z.enum(["haute", "moyenne", "basse"]).describe("Certitude de la lecture de cette photo");

export const fillupScanSchema = z.object({
  odometerKm: z.string().nullable().describe("Kilométrage total affiché par le compteur (odomètre), chiffres uniquement, sans le compteur journalier"),
  liters: z.string().nullable().describe("Volume servi (litres, ou kWh pour une borne), point décimal"),
  unitPrice: z.string().nullable().describe("Prix unitaire en euros par litre (ou par kWh), point décimal, ex. 1.789"),
  total: z.string().nullable().describe("Montant total à payer en euros, point décimal, ex. 72.45"),
  fuel: z.enum(FUEL_CODES).nullable().describe("Carburant servi : E85 (superéthanol), SP95, SP95_E10, SP98, GAZOLE (diesel, B7, B10, XTL…), GPL, ELEC_KWH"),
  date: z.string().nullable().describe("Date et heure d'un ticket au format AAAA-MM-JJTHH:MM, sinon null"),
  stationName: z.string().nullable().describe("Nom ou enseigne de la station s'il est lisible (ticket), sinon null"),
  confidence,
  note: z.string().nullable().describe("Courte remarque en français si une valeur est douteuse ou illisible, sinon null"),
});
export type FillupScan = z.infer<typeof fillupScanSchema>;

export const vehicleScanSchema = z.object({
  plate: z.string().nullable().describe("Immatriculation (champ A de la carte grise ou plaque visible), format AB-123-CD"),
  make: z.string().nullable().describe("Marque (champ D.1), ex. RENAULT"),
  model: z.string().nullable().describe("Modèle / dénomination commerciale (champ D.3), ex. CLIO"),
  year: z.number().int().nullable().describe("Année de première immatriculation (champ B)"),
  engine: z.string().nullable().describe("Motorisation courte si déductible (version, puissance), ex. 1.0 TCe 90 ch"),
  energy: z.enum(ENERGY_CODES).nullable().describe("Énergie (champ P.3) : ES=essence, GO=diesel, FE=e85_flex, GP/GPL ou bicarburation essence-GPL=gpl, EH/hybride non rechargeable=hybride, EE/hybride rechargeable=hybride_rechargeable, EL=electrique"),
  tankCapacityL: z.string().nullable().describe("Capacité du réservoir en litres seulement si elle est écrite, sinon null"),
  confidence,
  note: z.string().nullable().describe("Courte remarque en français si une valeur est douteuse, sinon null"),
});
export type VehicleScan = z.infer<typeof vehicleScanSchema>;

const FILLUP_PROMPT = `Tu lis des photos prises par un automobiliste au moment de faire le plein, pour pré-remplir un formulaire.
Les photos peuvent montrer : le compteur kilométrique du tableau de bord, l'écran de la pompe (volume, prix au litre, montant), ou un ticket de caisse.
Règles :
- Recopie uniquement ce qui est réellement lisible. Ne devine jamais un chiffre : mets null si c'est illisible ou absent.
- Compteur : prends le kilométrage TOTAL (odomètre), pas le compteur journalier (« trip », souvent avec décimale) ni l'autonomie.
- Pompe : identifie le volume, le prix unitaire et le montant ; le carburant d'après le pistolet ou le libellé (E10 = SP95_E10, B7/Diesel = GAZOLE).
- Nombres avec un point comme séparateur décimal, sans espace ni unité.`;

const VEHICLE_PROMPT = `Tu lis des photos d'un véhicule pour pré-remplir sa fiche dans une application de suivi de consommation.
Les photos peuvent montrer : un certificat d'immatriculation français (carte grise), le véhicule avec sa plaque, ou une étiquette.
Règles :
- Recopie uniquement ce qui est réellement lisible ; mets null sinon. Sur une simple photo du véhicule, tu peux reconnaître la marque et le modèle s'ils sont évidents (logo, monogramme), en confiance « moyenne ».
- Ignore et ne recopie jamais le nom, l'adresse ou toute donnée personnelle du titulaire.`;

let client: Anthropic | null = null;

export function ocrAvailable() {
  return Boolean(env.anthropicApiKey);
}

function getClient() {
  if (!env.anthropicApiKey) return null;
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, timeout: 60_000, maxRetries: 1 });
  return client;
}

export class OcrUnavailableError extends Error {}

async function read<T extends z.ZodType>(schema: T, prompt: string, images: ScanImage[], hint: string): Promise<z.infer<T>> {
  const c = getClient();
  if (!c) throw new OcrUnavailableError(OCR_UNAVAILABLE_MESSAGE);
  const content: Anthropic.ContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mimeType, data: img.data.toString("base64") },
  }));
  content.push({ type: "text", text: hint });
  const res = await c.messages.parse({
    model: env.ocrModel,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(schema) },
    system: prompt,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Lecture impossible");
  return res.parsed_output as z.infer<T>;
}

export function readFillupPhotos(images: ScanImage[], kinds: string[]) {
  return read(fillupScanSchema, FILLUP_PROMPT, images, `Photos fournies (dans l'ordre) : ${kinds.join(", ")}. Extrais les valeurs du plein.`);
}

export function readVehiclePhotos(images: ScanImage[], kinds: string[]) {
  return read(vehicleScanSchema, VEHICLE_PROMPT, images, `Photos fournies (dans l'ordre) : ${kinds.join(", ")}. Extrais les informations du véhicule.`);
}

/** Compatibilité avec le registre des intégrations et la route des pièces jointes. */
export function ocrProvider() {
  return ocrAvailable() ? { name: "anthropic" } : null;
}

export const OCR_UNAVAILABLE_MESSAGE = "Lecture automatique des photos pas encore activée : complétez le formulaire à la main.";
