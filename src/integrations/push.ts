import { env } from "@/server/env";

/** Contrat Web Push. Sans clés VAPID, seules les notifications dans l'application fonctionnent. */
export function pushAvailable() {
  return Boolean(env.pushVapidPublicKey && process.env.VAPID_PRIVATE_KEY);
}
