import { expect, type Page } from "@playwright/test";

/** Aucune page ne doit défiler horizontalement (§17 : 360 px minimum). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `débordement horizontal sur ${page.url()}`).toBeLessThanOrEqual(1);
}

export const TEST_PASSWORD = "mot-de-passe-de-test-42";

/** Création de compte par email et mot de passe (aucun service d'email nécessaire). */
export async function signUp(page: Page, email: string) {
  await page.goto("/connexion?mode=creation");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirmer le mot de passe").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL(/\/onboarding/);
}

/** Connexion par lien à usage unique (affiché à l'écran en test). */
export async function signInWithLink(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByLabel("Email pour le lien").fill(email);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  const link = page.getByRole("link", { name: /lien de connexion|Ouvrir le lien/i });
  await expect(link).toBeVisible();
  await link.click();
}

export const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
