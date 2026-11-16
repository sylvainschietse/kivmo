"use server";

import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { runAction, str, optStr } from "@/server/action";
import { draftQuoteRequest, sendQuoteRequest, withdrawQuoteConsent } from "@/server/services/partners";

export async function draftQuoteAction(fd: FormData) {
  const { ctx } = await requireSession();
  const ids = fd.getAll("partnerId").map(String);
  await runAction("/partenaires", async () => {
    const { request } = await draftQuoteRequest(getDb(), ctx, { vehicleId: optStr(fd, "vehicleId"), need: str(fd, "need"), zone: str(fd, "zone"), contactChannel: (str(fd, "contactChannel") || "email") as "email", contactValue: str(fd, "contactValue"), partnerIds: ids });
    return `/partenaires?demande=${request.id}&pros=${ids.join(",")}`;
  });
}

export async function sendQuoteAction(fd: FormData) {
  const { ctx } = await requireSession();
  const requestId = str(fd, "requestId");
  const ids = str(fd, "pros").split(",").filter(Boolean);
  await runAction(`/partenaires?demande=${requestId}&pros=${ids.join(",")}`, async () => {
    await sendQuoteRequest(getDb(), ctx, requestId, fd.getAll("consent").map(String), ids);
    return `/partenaires?ok=${encodeURIComponent("Demande envoyée aux professionnels choisis.")}`;
  });
}

export async function withdrawConsentAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/partenaires", async () => {
    await withdrawQuoteConsent(getDb(), ctx, str(fd, "recipientId"));
    return `/partenaires?ok=${encodeURIComponent("Consentement retiré : le professionnel ne voit plus vos coordonnées.")}`;
  });
}
