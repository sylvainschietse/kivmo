import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { handleBankWebhook } from "@/server/services/savings";
import { errorResponse, json } from "@/server/api";

/** Webhook prestataire : corps brut, signature HMAC (x-kivmo-signature) et horodatage (x-kivmo-timestamp). */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const r = await handleBankWebhook(getDb(), raw, { signature: req.headers.get("x-kivmo-signature"), timestamp: req.headers.get("x-kivmo-timestamp") });
    return json(r);
  } catch (e) {
    return errorResponse(e);
  }
}
