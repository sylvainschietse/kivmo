// Complète le projet Android généré par Capacitor : permissions utiles à KIVMO
// (position pour les stations proches, appareil photo pour les tickets) et numéro de version.
import { readFileSync, writeFileSync } from "node:fs";

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
