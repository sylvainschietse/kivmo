import "server-only";
import { env } from "@/server/env";
import { routingProvider } from "./routing";
import { ocrProvider } from "./ocr";

/**
 * Registre des intégrations externes (§15, §21). Chaque connecteur a un contrat d'interface
 * (voir les fichiers voisins), un état visible et, le cas échéant, une démonstration séparée.
 * Rien n'est présenté comme actif si la configuration manque.
 */
export type IntegrationStatus = "connecte" | "bac_a_sable" | "a_connecter" | "local";

export interface IntegrationInfo {
  key: string;
  label: string;
  status: IntegrationStatus;
  detail: string;
  fallback: string;
  envVars: string[];
}

export function integrations(): IntegrationInfo[] {
  return [
    {
      key: "auth_email",
      label: "Envoi des liens de connexion par email",
      status: env.emailProvider === "smtp" && process.env.SMTP_URL ? "connecte" : env.emailProvider === "console" ? "local" : "a_connecter",
      detail:
        env.emailProvider === "console"
          ? "Mode développement : le lien est écrit dans la console serveur et affiché à l'écran."
          : "Fournisseur email transactionnel à configurer (SMTP).",
      fallback: "Mode démonstration sans compte.",
      envVars: ["EMAIL_PROVIDER", "SMTP_URL", "EMAIL_FROM"],
    },
    {
      key: "fuel_prices",
      label: "Prix des carburants (flux public prix-carburants)",
      status: env.fuelPricesEnabled ? "connecte" : "a_connecter",
      detail: env.fuelPricesEnabled
        ? "Import serveur périodique avec cache ; derniers prix datés conservés."
        : "Activer FUEL_PRICES_SOURCE=prix-carburants après vérification des conditions de la source officielle.",
      fallback: "Derniers prix datés connus et saisie manuelle du prix.",
      envVars: ["FUEL_PRICES_SOURCE", "FUEL_PRICES_API_URL", "CRON_SECRET"],
    },
    {
      key: "map_tiles",
      label: "Fond de carte",
      // Aucun composant de carte n'est livré : l'état reste « à connecter » même si une URL est fournie.
      status: "a_connecter",
      detail: "Fournisseur de tuiles à choisir (quotas, licence, attribution), puis composant de carte à brancher sur la liste existante.",
      fallback: "Liste des stations, liens vers l'application de navigation.",
      envVars: ["NEXT_PUBLIC_MAP_TILE_URL", "NEXT_PUBLIC_MAP_ATTRIBUTION"],
    },
    {
      key: "routing",
      label: "Calcul d'itinéraire routier",
      status: routingProvider() ? "connecte" : "a_connecter",
      detail: "Aucune distance routière n'est calculée sans fournisseur : seules les distances à vol d'oiseau, identifiées comme telles.",
      fallback: "Saisie manuelle des kilomètres de détour ; navigation confiée à l'application GPS.",
      envVars: ["ROUTING_PROVIDER", "ROUTING_API_KEY"],
    },
    {
      key: "ocr",
      label: "Lecture automatique des tickets (OCR)",
      status: ocrProvider() ? "connecte" : "a_connecter",
      detail: "Coût, confidentialité, rétention et qualité à valider avant choix du prestataire.",
      fallback: "Le ticket est stocké en privé et le formulaire se remplit à la main.",
      envVars: ["OCR_PROVIDER", "OCR_API_KEY"],
    },
    {
      key: "bank",
      label: "Connexion bancaire et virements",
      // L'adaptateur de production n'existe pas encore : seul le bac à sable est exécutable.
      status: "bac_a_sable",
      detail:
        "Bac à sable intégré (machine d'états, webhooks signés, idempotence). Production non activée tant que le contrat et les capacités réelles ne sont pas vérifiés.",
      fallback: "Suivi manuel des virements déclarés (jamais présentés comme vérifiés par la banque).",
      envVars: ["BANK_PROVIDER", "BANK_ENVIRONMENT", "BANK_WEBHOOK_SECRET", "BANK_CLIENT_ID", "BANK_CLIENT_SECRET"],
    },
    {
      key: "push",
      label: "Notifications push",
      status: "a_connecter",
      detail: "Nécessite des clés VAPID, un service d'envoi et la permission du navigateur ; l'envoi n'est pas encore branché.",
      fallback: "Centre de notifications dans l'application.",
      envVars: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    },
    {
      key: "billing",
      label: "Facturation professionnelle",
      status: "a_connecter",
      detail: "Aucun tarif professionnel décidé : plans configurables, prix vides par défaut.",
      fallback: "Abonnements suivis en statut « à connecter ».",
      envVars: ["BILLING_PROVIDER", "BILLING_API_KEY"],
    },
    {
      key: "vehicle_catalog",
      label: "Recherche par immatriculation / catalogue véhicules",
      status: "a_connecter",
      detail: "Fournisseur autorisé à sélectionner.",
      fallback: "Saisie manuelle du véhicule, toujours disponible.",
      envVars: ["VEHICLE_CATALOG_PROVIDER"],
    },
    {
      key: "obd_fuel_cards",
      label: "OBD, cartes carburant, fidélité, bornes",
      status: "a_connecter",
      detail: "Connecteurs optionnels ; aucun scraping.",
      fallback: "Saisie manuelle et import CSV.",
      envVars: [],
    },
  ];
}

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  connecte: "Connecté",
  bac_a_sable: "Bac à sable",
  a_connecter: "À connecter",
  local: "Mode local",
};
