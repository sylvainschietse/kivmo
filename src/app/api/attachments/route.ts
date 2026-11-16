import { api } from "@/server/api";
import { storeAttachment } from "@/server/services/attachments";
import { AppError } from "@/server/errors";
import { ocrProvider, OCR_UNAVAILABLE_MESSAGE } from "@/integrations/ocr";

export const POST = api(async ({ req, db, ctx }) => {
  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "ticket");
  if (!(file instanceof File)) throw new AppError("VALIDATION", "Fichier manquant.");
  if (!["ticket", "compteur", "conversion", "entretien", "preuve", "photo"].includes(kind)) throw new AppError("VALIDATION", "Type de pièce invalide.");
  const data = Buffer.from(await file.arrayBuffer());
  const res = await storeAttachment(db, ctx, { kind, mimeType: file.type, data, organizationId: (form.get("organizationId") as string) || null });
  const ocr = ocrProvider();
  return {
    id: res.attachment.id,
    duplicate: res.duplicate,
    usedByFillupId: res.usedByFillupId,
    ocr: ocr ? { status: "a_confirmer" } : { status: "a_connecter", message: OCR_UNAVAILABLE_MESSAGE },
  };
});
