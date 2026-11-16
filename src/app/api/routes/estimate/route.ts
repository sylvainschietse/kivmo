import { api } from "@/server/api";
import { routingProvider } from "@/integrations/routing";
import { AppError } from "@/server/errors";

/** Itinéraire routier : uniquement via un fournisseur connecté. Aucune estimation inventée. */
export const POST = api(async ({ req }) => {
  const provider = routingProvider();
  if (!provider) throw new AppError("NOT_CONNECTED", "Calcul d'itinéraire à connecter : saisissez la distance ou utilisez votre application GPS.");
  const body = (await req.json()) as { points: { lat: number; lng: number }[] };
  return provider.estimate(body.points);
});
