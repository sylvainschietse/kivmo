import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp, unique } from "./helpers";

test.describe("Mode démonstration", () => {
  test("ouvre la démo isolée et parcourt les écrans principaux sans débordement", async ({ page }) => {
    await page.goto("/");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Découvrir en mode démo" }).click();
    await expect(page).toHaveURL(/\/accueil/);
    await expect(page.getByText(/démonstration/i).first()).toBeVisible();
    for (const path of ["/accueil", "/historique", "/analyses", "/simulations?modele=captur", "/stations", "/trajets", "/projets", "/projets/epargne", "/garage", "/partenaires", "/notifications", "/profil", "/entreprise"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText("Application error")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    }
    // Les données de démonstration sont marquées comme telles.
    await page.goto("/historique");
    await expect(page.getByText(/démonstration/i).first()).toBeVisible();
  });

  test("virement fictif en bac à sable : préparation, autorisation, confirmation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Découvrir en mode démo" }).click();
    await page.waitForURL(/\/accueil/);
    // Démo : la conversion n'est pas encore amortie ; on choisit de ne pas la déduire pour affecter les gains carburant.
    await page.goto("/profil");
    await page.getByLabel(/Déduire le coût de conversion/).uncheck();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
    await expect(page.getByText("Profil enregistré.")).toBeVisible();
    await page.goto("/projets");
    await page.getByRole("button", { name: "Affecter aux projets selon la répartition" }).click();
    await expect(page.getByText(/affectés à vos projets/)).toBeVisible();
    await page.goto("/projets/epargne");
    await expect(page.getByText("Bac à sable bancaire")).toBeVisible();
    if (await page.getByRole("button", { name: "Connecter la banque fictive" }).isVisible()) {
      await page.getByLabel(/J.accepte de connecter/).check();
      await page.getByRole("button", { name: "Connecter la banque fictive" }).click();
    }
    await page.getByLabel("Montant (€)").fill("1");
    await page.getByRole("button", { name: "Préparer" }).click();
    await expect(page.getByText("Ordre préparé")).toBeVisible();
    await page.getByLabel(/Je confirme ce virement/).check();
    await page.getByRole("button", { name: "Soumettre" }).click();
    await expect(page).toHaveURL(/bac-a-sable/);
    await expect(page.getByText("Aucun virement réel").first()).toBeVisible();
    await page.getByRole("button", { name: "Autoriser" }).click();
    await expect(page.getByText("Virement fictif confirmé")).toBeVisible();
    await expect(page.getByText("Confirmé").first()).toBeVisible();
  });
});

test.describe("Compte réel", () => {
  test("inscription, véhicule, deux pleins complets, consommation mesurée et export", async ({ page }) => {
    await signUp(page, unique("conducteur"));
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel("Nom du véhicule").fill("Clio test");
    await page.getByLabel("Kilométrage actuel").fill("10000");
    await page.getByLabel("Consommation de référence (L/100 km)").fill("6");
    await page.getByLabel("Prix fixe de scénario (€/L, facultatif)").fill("1,90");
    await page.getByRole("button", { name: "Terminer la configuration" }).click();
    await expect(page).toHaveURL(/\/accueil/);
    await expect(page.getByText("Premier plein", { exact: true })).toBeVisible();

    // Premier plein complet : point de départ.
    await page.goto("/pleins/nouveau");
    await page.getByLabel("Date et heure").fill("2026-11-10T09:00");
    await page.getByLabel("Compteur (km)").fill("10000");
    await page.getByLabel("Litres").fill("40");
    await page.getByLabel("Prix affiché (€/L)").fill("1,800");
    await expect(page.getByLabel("Total payé (€)")).toHaveValue("72,00");
    await page.getByRole("button", { name: "Enregistrer le plein" }).click();
    await expect(page.getByText("Premier plein : point de départ")).toBeVisible();

    // Second plein complet : 500 km, 30 L → 6,00 L/100.
    await page.goto("/pleins/nouveau");
    await page.getByLabel("Compteur (km)").fill("10500");
    await page.getByLabel("Litres").fill("30");
    await page.getByLabel("Total payé (€)").fill("54");
    await expect(page.getByLabel("Prix affiché (€/L)")).toHaveValue("1,800");
    await page.getByRole("button", { name: "Enregistrer le plein" }).click();
    await expect(page.getByText(/6,00\s?L\/100/).first()).toBeVisible();

    await page.goto("/analyses");
    await expect(page.getByText("Mesuré").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const res = await page.request.get("/api/exports");
    expect(res.status()).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Clio test");
  });

  test("recherche de station avec géolocalisation refusée : repli sur la recherche par ville", async ({ page, context }) => {
    await context.clearPermissions();
    await signUp(page, unique("stations"));
    await page.goto("/stations");
    await page.getByRole("button", { name: "Autour de moi" }).click();
    await expect(page.getByText(/Position refusée|Position introuvable|indisponible/)).toBeVisible();
    await page.getByLabel("Ville, code postal ou adresse").fill("Lyon");
    await page.getByRole("button", { name: "Chercher" }).click();
    await expect(page.getByText(/Aucune station trouvée|station\(s\)/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("hors ligne : le plein est placé dans la file locale, sans envoi silencieux", async ({ page, context }) => {
    await signUp(page, unique("horsligne"));
    await page.getByLabel("Nom du véhicule").fill("Hors ligne");
    await page.getByLabel("Kilométrage actuel").fill("500");
    await page.getByRole("button", { name: "Terminer la configuration" }).click();
    await page.waitForURL(/\/accueil/);
    await page.goto("/pleins/nouveau");
    await page.getByLabel("Compteur (km)").fill("600");
    await page.getByLabel("Litres").fill("20");
    await page.getByLabel("Total payé (€)").fill("36");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Enregistrer le plein" }).click();
    await expect(page.getByText(/file locale/)).toBeVisible();
    await context.setOffline(false);
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("kivmo-offline-fillups") ?? "[]").length);
    expect(queued).toBe(1);
  });

  test("isolation : une organisation n'est pas visible par un autre compte", async ({ browser }) => {
    const a = await browser.newContext();
    const pa = await a.newPage();
    await signUp(pa, unique("proprio"));
    await pa.getByLabel("Nom du véhicule").fill("V");
    await pa.getByRole("button", { name: "Terminer la configuration" }).click();
    await pa.waitForURL(/\/accueil/);
    await pa.goto("/entreprise");
    await pa.getByLabel("Nom", { exact: true }).fill("Société A");
    await pa.getByRole("button", { name: "Créer", exact: true }).click();
    await expect(pa).toHaveURL(/\/entreprise\/[0-9a-f-]{36}/);
    const orgUrl = new URL(pa.url()).pathname;
    await expect(pa.getByRole("heading", { name: "Société A" })).toBeVisible();

    const b = await browser.newContext();
    const pb = await b.newPage();
    await signUp(pb, unique("intrus"));
    const res = await pb.goto(orgUrl);
    expect(res?.status()).toBe(404);
    await expect(pb.getByText("Société A")).toHaveCount(0);
    await a.close();
    await b.close();
  });
});
