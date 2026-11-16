import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { AppError, validation } from "../errors";
import { requireAttachment, type Ctx } from "../authz";
import { sha256, signAttachmentUrl } from "../auth";
import { env } from "../env";
import { audit } from "../audit";

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/webp", [0x52, 0x49, 0x46, 0x46]],
  ["application/pdf", [0x25, 0x50, 0x44, 0x46]],
]);

/** Vérifie le type réel par signature binaire (pas seulement l'extension ou l'en-tête). */
export function sniffMime(buf: Buffer, declared: string) {
  const magic = ALLOWED.get(declared);
  if (!magic) return false;
  return magic.every((b, i) => buf[i] === b);
}

/**
 * Stockage privé hors du dossier public. Lecture uniquement via autorisation + URL temporaire.
 * Le hash SHA-256 empêche qu'un même ticket crée deux pleins (double clic, synchronisation).
 * Analyse antivirus : à brancher selon le service de stockage retenu (§16).
 */
export async function storeAttachment(db: DB, ctx: Ctx, input: { kind: string; mimeType: string; data: Buffer; organizationId?: string | null }) {
  if (input.data.length === 0) throw validation("Fichier vide.");
  if (input.data.length > MAX_ATTACHMENT_BYTES) throw validation("Fichier trop volumineux (8 Mo maximum).");
  if (!sniffMime(input.data, input.mimeType)) throw validation("Type de fichier non accepté (JPEG, PNG, WebP ou PDF).");
  const hash = sha256(input.data);
  const [existing] = await db.select().from(schema.attachments).where(and(eq(schema.attachments.ownerUserId, ctx.userId), eq(schema.attachments.sha256, hash), eq(schema.attachments.kind, input.kind)));
  if (existing) {
    const [used] = await db.select({ id: schema.fillups.id }).from(schema.fillups).where(eq(schema.fillups.receiptAttachmentId, existing.id));
    return { attachment: existing, duplicate: true, usedByFillupId: used?.id ?? null };
  }
  const key = `${ctx.userId}/${hash.slice(0, 2)}/${hash}`;
  const full = path.join(env.storageDir, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, input.data, { mode: 0o600 });
  const [row] = await db
    .insert(schema.attachments)
    .values({ ownerUserId: ctx.userId, organizationId: input.organizationId ?? null, kind: input.kind, storageKey: key, mimeType: input.mimeType, sizeBytes: input.data.length, sha256: hash })
    .returning();
  await audit(db, { actorUserId: ctx.userId, organizationId: input.organizationId, action: "attachment.upload", resourceType: "attachment", resourceId: row.id, details: { kind: input.kind, size: row.sizeBytes } });
  return { attachment: row, duplicate: false, usedByFillupId: null };
}

export async function attachmentUrl(db: DBOrTx, ctx: Ctx, attachmentId: string) {
  await requireAttachment(db, ctx, attachmentId);
  return signAttachmentUrl(attachmentId);
}

export async function readAttachment(db: DBOrTx, ctx: Ctx, attachmentId: string) {
  const a = await requireAttachment(db, ctx, attachmentId);
  try {
    const data = await readFile(path.join(env.storageDir, a.storageKey));
    return { attachment: a, data };
  } catch {
    throw new AppError("NOT_FOUND", "Fichier indisponible.");
  }
}

export async function deleteStoredFile(storageKey: string) {
  await unlink(path.join(env.storageDir, storageKey)).catch(() => undefined);
}
