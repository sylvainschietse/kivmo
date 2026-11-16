import { schema, type DBOrTx } from "@/db/client";

const SECRET_KEYS = /iban|token|secret|password|authorization|cookie/i;

/** Retire toute valeur sensible avant journalisation. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[masqué]" : redact(v);
    return out;
  }
  return value;
}

export async function audit(
  db: DBOrTx,
  e: { actorUserId: string | null; organizationId?: string | null; action: string; resourceType: string; resourceId?: string | null; details?: Record<string, unknown> },
) {
  await db.insert(schema.auditEvents).values({
    actorUserId: e.actorUserId,
    organizationId: e.organizationId ?? null,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId ?? null,
    details: redact(e.details ?? {}) as Record<string, unknown>,
  });
}
