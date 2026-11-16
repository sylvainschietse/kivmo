# Déploiement

KIVMO est une application Next.js (rendu serveur, routes API, actions serveur) avec PostgreSQL.
Elle se déploie sur tout hébergement Node.js 22 capable de garder un processus actif, ou sur une
plateforme Next.js gérée.

## Étapes

1. Provisionner PostgreSQL 16+ (sauvegardes quotidiennes et restauration testée).
2. Définir les variables d'environnement (voir `.env.example`) :
   - obligatoires : `DATABASE_URL`, `SESSION_SECRET` (32 caractères ou plus), `APP_URL` (HTTPS), `CRON_SECRET`, `BANK_WEBHOOK_SECRET` ;
   - `EMAIL_PROVIDER=smtp` + `SMTP_URL` + `EMAIL_FROM` : sans fournisseur, aucun lien de connexion n'est envoyé (seule la démo fonctionne) ;
   - `DEMO_MODE=on|off` selon que la démonstration publique doit rester ouverte ;
   - `STORAGE_DIR` : dossier **privé et persistant** pour les tickets et justificatifs (jamais servi en statique). Sur un hébergement sans disque persistant, brancher un stockage objet privé (voir limites).
3. `npm ci && npm run build`
4. `npm run db:migrate` à chaque mise en production, avant le démarrage.
5. `npm start` (port `PORT`, 3000 par défaut) derrière un proxy HTTPS.
6. Planifier les trois tâches `cron` (voir `docs/demarrage.md`).
7. Vérifier `GET /api/health` et la page `/integrations`.

## Sécurité en production

- Cookies de session `HttpOnly`, `Secure`, `SameSite=Lax` ; vérification d'origine sur les écritures de l'API (et contrôle natif de Next.js pour les actions serveur).
- En-têtes de sécurité définis dans `next.config.ts` (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`). Une politique CSP stricte reste à définir avec l'hébergeur retenu.
- Pièces jointes servies uniquement par URL signée et courte, avec revérification de la session.
- Journal d'audit sans secrets (valeurs sensibles masquées).
- Limitation de débit sur la connexion, les signalements et l'API.
- Le bac à sable bancaire est la seule banque exécutable : `BANK_ENVIRONMENT=production` sans adaptateur réel renvoie « À connecter » au lieu de simuler.

## Intégration continue

`.github/workflows/ci.yml` : vérification des types, lint, tests unitaires et d'intégration sur
PostgreSQL 16, puis build et parcours navigateur Playwright.
