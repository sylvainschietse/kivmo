import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { membershipOf } from "./authz";
import { requireSession } from "./session";

/**
 * Garde des pages d'organisation : la mise en page et la page sont rendues en parallèle,
 * chaque page vérifie donc elle-même l'appartenance (404 pour un non-membre, sans fuite).
 */
export async function requireOrgPage(orgId: string) {
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const s = await requireSession();
  const m = await membershipOf(getDb(), s.ctx, orgId);
  if (!m) notFound();
  return { ...s, membership: m };
}
