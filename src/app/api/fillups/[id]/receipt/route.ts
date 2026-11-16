import { api } from "@/server/api";
import { getFillup } from "@/server/services/fillups";
import { attachmentUrl } from "@/server/services/attachments";
import { AppError } from "@/server/errors";

/** Renvoie une URL temporaire signée vers le ticket, après contrôle d'accès. */
export const GET = api<{ id: string }>(async ({ db, ctx, params }) => {
  const { fillup } = await getFillup(db, ctx, params.id);
  if (!fillup.receiptAttachmentId) throw new AppError("NOT_FOUND", "Aucun ticket pour ce plein.");
  return { url: await attachmentUrl(db, ctx, fillup.receiptAttachmentId), expiresInSeconds: 300 };
});
