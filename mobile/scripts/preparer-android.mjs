// Complète le projet Android généré par Capacitor : permissions utiles à KIVMO
// (position pour les stations proches, appareil photo pour les tickets) et numéro de version.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = readFileSync(manifestPath, "utf8");
const permissions = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.CAMERA",
];
for (const p of permissions) {
  if (!manifest.includes(p)) {
    manifest = manifest.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      `<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="${p}" />`,
    );
  }
}
if (!manifest.includes("android.hardware.camera")) {
  manifest = manifest.replace("<!-- Permissions -->", '<!-- Permissions -->\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />');
}
writeFileSync(manifestPath, manifest);

const versionCode = Number(process.env.VERSION_CODE ?? 1);
const versionName = process.env.VERSION_NAME ?? "1.0.0";
const gradlePath = "android/app/build.gradle";
let gradle = readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`).replace(/versionName "[^"]*"/, `versionName "${versionName}"`);
writeFileSync(gradlePath, gradle);
console.log(`Android prêt : version ${versionName} (${versionCode}), permissions ${permissions.length}`);

// Bouton retour d'Android : revient à la page précédente de KIVMO, et ne quitte l'appli
// que depuis la première page (sans cela, il fermait l'appli depuis la fiche d'une station).
const activityDir = "android/app/src/main/java/fr/kivmo/app";
mkdirSync(activityDir, { recursive: true });
writeFileSync(
  `${activityDir}/MainActivity.java`,
  `package fr.kivmo.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web != null && web.canGoBack()) {
                    web.goBack();
                } else {
                    // Mise en arrière-plan sans désactiver ce comportement :
                    // à la réouverture, le bouton retour revient toujours à la page précédente.
                    moveTaskToBack(true);
                }
            }
        });
    }
}
`,
);
console.log("Bouton retour : historique de navigation");
