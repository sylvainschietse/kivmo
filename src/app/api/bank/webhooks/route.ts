import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { handleBankWebhook } from "@/server/services/savings";
import { errorResponse, json } from "@/server/api";
import { env } from "@/server/env";

/** Webhook prestataire : corps brut, signature HMAC (x-kivmo-signature) et horodatage (x-kivmo-timestamp). */
export async function POST(req: NextRequest) {
  // Sans secret configuré, la signature serait calculée avec une clé vide, donc falsifiable : on refuse tout.
  if (!env.bankWebhookSecret) return json({ error: { code: "NOT_CONNECTED", message: "Webhooks bancaires non configurés." } }, 503);
  try {
    const raw = await req.text();
    const r = await handleBankWebhook(getDb(), raw, { signature: req.headers.get("x-kivmo-signature"), timestamp: req.headers.get("x-kivmo-timestamp") });
    return json(r);
  } catch (e) {
    return errorResponse(e);
  }
}
