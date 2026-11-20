import { expect, test, type Browser } from "@playwright/test";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

async function openDemo(browser: Browser, userAgent: string, init?: string) {
  const context = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "fr-FR" });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Découvrir en mode démo" }).click();
  await page.waitForURL(/\/accueil/);
  return { context, page };
}

test.describe("Application sur téléphone", () => {
  test("manifeste installable et icônes servies", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/accueil");
    expect(m.icons.some((i: { purpose?: string; sizes: string }) => i.purpose === "maskable" && i.sizes === "512x512")).toBeTruthy();
    expect(m.icons.some((i: { purpose?: string; sizes: string }) => !i.purpose && i.sizes === "192x192")).toBeTruthy();
    for (const icon of [...m.icons.map((i: { src: string }) => i.src), "/apple-touch-icon.png", "/sw.js"]) {
      expect((await request.get(icon)).status(), icon).toBe(200);
    }
  });

  test("iPhone : balises Apple et marche à suivre dans Safari", async ({ browser }) => {
    const { context, page } = await openDemo(browser, IPHONE_UA);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
    const aide = page.getByTestId("installer-appli");
    await expect(aide).toContainText("Sur l'écran d'accueil");
    await aide.getByRole("button", { name: "Ne plus afficher" }).click();
    await expect(aide).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("installer-appli")).toHaveCount(0);
    await context.close();
  });

  test("Android : le bouton d'installation déclenche la fenêtre du navigateur", async ({ browser }) => {
    const { context, page } = await openDemo(browser, ANDROID_UA);
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      e.prompt = async () => {
        (window as unknown as { __promptAppele: boolean }).__promptAppele = true;
      };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(e);
    });
    await page.getByRole("button", { name: "Installer l'application" }).click();
    expect(await page.evaluate(() => (window as unknown as { __promptAppele?: boolean }).__promptAppele)).toBe(true);
    await expect(page.getByTestId("installer-appli")).toHaveCount(0);
    await context.close();
  });

  test("appli déjà installée : aucune invitation à installer", async ({ browser }) => {
    const { context, page } = await openDemo(
      browser,
      IPHONE_UA,
      `Object.defineProperty(window.navigator, "standalone", { get: () => true });`,
    );
    await expect(page.getByTestId("installer-appli")).toHaveCount(0);
    await page.goto("/profil");
    await expect(page.getByText("KIVMO est installée sur cet appareil.")).toBeVisible();
    await context.close();
  });
});
