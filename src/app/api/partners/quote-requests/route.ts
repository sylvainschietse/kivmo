import { api } from "@/server/api";
import { draftQuoteRequest, myQuoteRequests, sendQuoteRequest } from "@/server/services/partners";

export const GET = api(async ({ db, ctx }) => myQuoteRequests(db, ctx));
/** Brouillon puis envoi explicite : { ..., confirm: true, consentedPartnerIds } */
export const POST = api(async ({ req, db, ctx }) => {
  const b = await req.json();
  const { request } = await draftQuoteRequest(db, ctx, b);
  if (b.confirm === true) await sendQuoteRequest(db, ctx, request.id, b.consentedPartnerIds ?? [], b.partnerIds);
  return { id: request.id, sent: b.confirm === true };
});
