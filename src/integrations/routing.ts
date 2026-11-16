import { env } from "@/server/env";

/**
 * Contrat de calcul d'itinéraire (fournisseur interchangeable). Sans fournisseur, aucune distance
 * routière n'est inventée : l'interface affiche des distances à vol d'oiseau, identifiées comme telles.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteEstimate {
  distanceKm: number;
  durationMin: number;
  tollsEstimate: number | null;
  provider: string;
  attribution: string;
}

export interface RoutingProvider {
  name: string;
  estimate(points: LatLng[]): Promise<RouteEstimate>;
}

export function routingProvider(): RoutingProvider | null {
  if (!env.routingProvider) return null;
  // Point d'intégration : quotas, coûts, licence et attribution à vérifier avant branchement.
  return null;
}

/** Pays couverts par les données de prix actuellement intégrées. */
export const COVERED_COUNTRIES = ["FR"];
