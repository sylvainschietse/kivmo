import { expect, type Page } from "@playwright/test";

/** Aucune page ne doit défiler horizontalement (§17 : 360 px minimum). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `débordement horizontal sur ${page.url()}`).toBeLessThanOrEqual(1);
}

export async function signUp(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  // En environnement sans fournisseur d'e-mail, le lien de développement est affiché.
  const link = page.getByRole("link", { name: /lien de connexion|Ouvrir le lien/i });
  await expect(link).toBeVisible();
  await link.click();
}

export const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
