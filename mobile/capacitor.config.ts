import type { CapacitorConfig } from "@capacitor/cli";

// L'APK ne contient pas l'application : elle ouvre la version en ligne (KIVMO_URL),
// si bien que chaque mise à jour publiée sur Vercel est visible sans réinstaller l'APK.
const url = process.env.KIVMO_URL;
if (!url || !/^https:\/\//.test(url)) throw new Error("KIVMO_URL manquant : adresse https de KIVMO en ligne (ex. https://kivmo.vercel.app)");

const config: CapacitorConfig = {
  appId: "fr.kivmo.app",
  appName: "KIVMO",
  webDir: "www",
  server: { url, cleartext: false, errorPath: "hors-ligne.html" },
  android: { appendUserAgent: "KivmoAndroid", allowMixedContent: false },
};

export default config;
