# KIVMO pour Android (APK)

Ce dossier produit une APK Android qui ouvre KIVMO en ligne dans une fenêtre d'application,
avec l'icône KIVMO sur l'écran d'accueil. L'APK ne contient pas l'application elle-même :
chaque mise à jour publiée sur Vercel est visible sans réinstaller l'APK.

## Construire l'APK

Sur GitHub : onglet **Actions**, workflow **APK Android**, bouton **Run workflow**, en indiquant
l'adresse https de KIVMO (ou en définissant une fois la variable de dépôt `KIVMO_URL`).
L'APK est publiée dans la release **android** du dépôt (fichier `KIVMO.apk`).

## Clé de signature

Pour que les versions suivantes de l'APK s'installent par-dessus l'ancienne, enregistrez une clé
dans les secrets du dépôt : `ANDROID_KEYSTORE_BASE64` (fichier keystore encodé en base64, alias `kivmo`)
et `ANDROID_KEYSTORE_PASSWORD`. Sans ces secrets, une clé temporaire est utilisée et il faut
désinstaller l'ancienne APK avant d'installer la nouvelle.

## Ce que l'APK autorise

Internet, position (stations proches) et appareil photo (tickets). L'agent utilisateur contient
`KivmoAndroid`, ce qui masque l'aide « installer l'application » dans KIVMO.

## En local

```
cd mobile && npm install
KIVMO_URL=https://kivmo.vercel.app npx cap add android
npm run icones && node scripts/preparer-android.mjs
KIVMO_URL=https://kivmo.vercel.app npx cap sync android   # puis ouvrir android/ dans Android Studio
```
