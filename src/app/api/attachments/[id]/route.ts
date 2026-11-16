import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { resolveSession, SESSION_COOKIE, verifyAttachmentSignature } from "@/server/auth";
import { readAttachment } from "@/server/services/attachments";
import { errorResponse, json } from "@/server/api";

/** Lecture d'une pièce : URL signée non expirée ET session autorisée (cas I). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!verifyAttachmentSignature(id, req.nextUrl.searchParams.get("exp"), req.nextUrl.searchParams.get("sig")))
    return json({ error: { code: "FORBIDDEN", message: "Lien expiré ou invalide." } }, 403);
  const s = await resolveSession(db, req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return json({ error: { code: "UNAUTHENTICATED", message: "Connexion requise." } }, 401);
  try {
    const { attachment, data } = await readAttachment(db, s.ctx, id);
    return new Response(new Uint8Array(data), { headers: { "content-type": attachment.mimeType, "cache-control": "private, no-store", "content-disposition": "inline", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return errorResponse(e);
  }
}
