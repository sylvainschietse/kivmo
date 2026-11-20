import { expect, test } from "@playwright/test";
import { signInWithLink, signUp, TEST_PASSWORD, unique } from "./helpers";

test.describe("Compte", () => {
  test("création par mot de passe, déconnexion, erreur puis reconnexion", async ({ page }) => {
    const email = unique("motdepasse");
    await signUp(page, email);
    await page.goto("/profil");
    await page.getByRole("button", { name: "Se déconnecter" }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/profil"));

    await page.goto("/connexion");
    await page.getByLabel("Adresse email").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("pas-le-bon-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Adresse email ou mot de passe incorrect.")).toBeVisible();

    await page.getByLabel("Mot de passe", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/\/(onboarding|accueil)/);
  });

  test("le lien à usage unique reste disponible quand l'envoi d'emails l'est", async ({ page }) => {
    await signInWithLink(page, unique("lien"));
    await expect(page).toHaveURL(/\/onboarding/);
  });
});
