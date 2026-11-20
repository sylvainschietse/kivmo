import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.E2E_DATABASE_URL ?? "postgres://kivmo:kivmo@localhost:5432/kivmo_e2e";
// Navigateur préinstallé dans certains environnements ; sinon celui de `npx playwright install chromium`.
const executablePath = process.env.PW_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "fr-FR", timezoneId: "Europe/Paris", launchOptions: { executablePath } },
  projects: [
    { name: "mobile-360", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "bureau", testIgnore: /appli\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    command: `npx tsx scripts/migrate.ts && npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: DB, APP_URL: `http://localhost:${PORT}`, SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-32", EMAIL_PROVIDER: "console", DEMO_MODE: "on", BANK_ENVIRONMENT: "sandbox", BANK_WEBHOOK_SECRET: "e2e-webhook-secret", STORAGE_DIR: "./storage-e2e", CRON_SECRET: "e2e-cron" },
  },
});
