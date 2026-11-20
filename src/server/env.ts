import "server-only";

/** Lecture centralisée de la configuration. Aucune valeur secrète n'a de défaut en production. */
export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? "development";
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get sessionSecret() {
    const s = process.env.SESSION_SECRET;
    if (!s && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET manquant");
    return s ?? "dev-only-insecure-secret-change-me-0123456789";
  },
  get storageDir() {
    return process.env.STORAGE_DIR ?? "./storage";
  },
  get emailProvider() {
    return process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "console");
  },
  get fuelPricesEnabled() {
    return process.env.FUEL_PRICES_SOURCE === "prix-carburants";
  },
  get fuelPricesApiUrl() {
    return (
      process.env.FUEL_PRICES_API_URL ??
      "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records"
    );
  },
  get mapTileUrl() {
    return process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "";
  },
  get routingProvider() {
    return process.env.ROUTING_PROVIDER ?? "";
  },
  get ocrProvider() {
    return process.env.OCR_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "");
  },
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY ?? "";
  },
  get ocrModel() {
    return process.env.OCR_MODEL ?? "claude-opus-5-5";
  },
  /** « db » : fichiers stockés dans PostgreSQL (durable sur Vercel, dont le disque est éphémère). */
  get storageBackend(): "db" | "disk" {
    const b = process.env.STORAGE_BACKEND;
    if (b === "db" || b === "disk") return b;
    return process.env.VERCEL ? "db" : "disk";
  },
  get bankProvider() {
    return process.env.BANK_PROVIDER ?? "";
  },
  get bankEnvironment(): "sandbox" | "production" {
    return process.env.BANK_ENVIRONMENT === "production" ? "production" : "sandbox";
  },
  get bankWebhookSecret() {
    return process.env.BANK_WEBHOOK_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-sandbox-webhook-secret");
  },
  get pushVapidPublicKey() {
    return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  },
  get billingProvider() {
    return process.env.BILLING_PROVIDER ?? "";
  },
  get demoEnabled() {
    return process.env.DEMO_MODE !== "off";
  },
};
