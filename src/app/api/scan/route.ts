import { api } from "@/server/api";
import { AppError } from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";
import { sniffMime } from "@/server/services/attachments";
import { ocrAvailable, OCR_UNAVAILABLE_MESSAGE, readFillupPhotos, readMaintenancePhotos, readVehiclePhotos, type ScanImage } from "@/integrations/ocr";

export const maxDuration = 60;

const KINDS = { fillup: ["compteur", "pompe", "ticket"], vehicle: ["carte_grise", "vehicule"], maintenance: ["facture"] } as const;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Lecture de photos pour pré-remplir un formulaire (plein, véhicule ou entretien).
 * Les photos ne sont pas enregistrées : seules les valeurs lues sont renvoyées, à vérifier.
 */
export const POST = api(async ({ req, db, ctx }) => {
  if (!ocrAvailable()) throw new AppError("NOT_CONNECTED", OCR_UNAVAILABLE_MESSAGE);
  await checkRateLimit(db, `scan:${ctx.userId}`, 40, 3600);
  const form = await req.formData();
  const target = String(form.get("target") ?? "");
  if (target !== "fillup" && target !== "vehicle" && target !== "maintenance") throw new AppError("VALIDATION", "Cible de lecture invalide.");
  const allowed: readonly string[] = KINDS[target];
  const images: ScanImage[] = [];
  const kinds: string[] = [];
  for (const [key, value] of form.entries()) {
    if (!(value instanceof File) || !allowed.includes(key)) continue;
    const data = Buffer.from(await value.arrayBuffer());
    if (data.length === 0 || data.length > MAX_BYTES) throw new AppError("VALIDATION", "Photo vide ou trop lourde.");
    const mime = value.type as ScanImage["mimeType"];
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || !sniffMime(data, mime)) throw new AppError("VALIDATION", "Format de photo non accepté (JPEG, PNG ou WebP).");
    images.push({ data, mimeType: mime });
    kinds.push(key.replace("_", " "));
  }
  if (images.length === 0) throw new AppError("VALIDATION", "Aucune photo reçue.");
  if (images.length > 3) throw new AppError("VALIDATION", "Trois photos au maximum.");
  try {
    const result =
      target === "fillup" ? await readFillupPhotos(images, kinds) : target === "vehicle" ? await readVehiclePhotos(images, kinds) : await readMaintenancePhotos(images, kinds);
    return { target, result };
  } catch (e) {
    console.error("[scan] lecture impossible", e);
    throw new AppError("UPSTREAM", "La lecture de la photo n'a pas abouti. Réessayez avec une photo plus nette, ou complétez à la main.");
  }
});
