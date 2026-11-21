import { expect, test } from "@playwright/test";

test.describe("Carte des stations", () => {
  test("prix du carburant choisi sur la carte, meilleur prix mis en avant, fiche accessible", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Découvrir en mode démo" }).click();
    await page.waitForURL(/\/accueil/);

    await page.goto("/stations?lat=48.853&lng=2.38&rayon=10&fuel=E85");
    const carte = page.getByTestId("carte-stations");
    await expect(carte).toBeVisible();
    // Une étiquette par station proposant l'E85, avec son prix (la station sans E85 n'apparaît pas).
    const pins = carte.locator(".kivmo-pin");
    await expect(pins).toHaveCount(3);
    const texts = (await pins.allTextContents()).map((t) => t.replace(/\s/g, " "));
    expect(texts.sort()).toEqual(["0,879 €", "0,899 €", "0,949 €"]);
    // Au plus un meilleur prix mis en avant, jamais sur un prix ancien.
    expect(await carte.locator(".kivmo-pin-best").count()).toBeLessThanOrEqual(1);
    await expect(carte.locator(".kivmo-pin-best.kivmo-pin-stale")).toHaveCount(0);

    await pins.filter({ hasText: "0,899" }).click();
    const popup = carte.locator(".leaflet-popup-content");
    await expect(popup).toContainText("Station Démo Bastille");
    await expect(popup).toContainText(/km à vol d'oiseau/);
    await popup.getByRole("link", { name: "Voir la station" }).click();
    await expect(page).toHaveURL(/\/stations\/[0-9a-f-]+$/);
  });

  test("sans carburant choisi, la carte invite à en choisir un", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Découvrir en mode démo" }).click();
    await page.waitForURL(/\/accueil/);
    await page.goto("/stations?lat=48.853&lng=2.38&rayon=10");
    await expect(page.getByTestId("carte-stations")).toBeVisible();
    await expect(page.getByText("Choisissez un carburant dans les filtres")).toBeVisible();
  });

  test("tri par distance puis retour depuis la fiche vers la liste", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Découvrir en mode démo" }).click();
    await page.waitForURL(/\/accueil/);
    await page.goto("/stations?lat=48.853&lng=2.38&rayon=10&fuel=E85");
    const tri = page.getByRole("navigation", { name: "Trier les stations" });
    await expect(tri.getByRole("link", { name: "Prix" })).toHaveAttribute("aria-current", "true");
    await tri.getByRole("link", { name: "Distance" }).click();
    await expect(page).toHaveURL(/tri=distance/);
    await expect(tri.getByRole("link", { name: "Distance" })).toHaveAttribute("aria-current", "true");
    const kms = (await page.locator("section[aria-label='Résultats'] li p.num").allTextContents()).map((t) => Number(t.replace(/[^0-9,]/g, "").replace(",", ".")));
    expect(kms).toEqual([...kms].sort((a, b) => a - b));

    await page.locator("section[aria-label='Résultats'] ul a").first().click();
    await expect(page).toHaveURL(/\/stations\/[0-9a-f-]+$/);
    await page.getByRole("button", { name: "Retour" }).click();
    await expect(page).toHaveURL(/\/stations\?.*tri=distance/);
  });
});
