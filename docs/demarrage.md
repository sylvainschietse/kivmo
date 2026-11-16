# Démarrer KIVMO en local

## Prérequis

- Node.js 22 ou plus récent, npm.
- PostgreSQL 16 ou plus récent.
- Pour les parcours navigateur : Chromium installé par `npx playwright install chromium`.

## Installation

```bash
git clone https://github.com/sylvainschietse/kivmo.git && cd kivmo
npm ci
cp .env.example .env.local
```

Dans `.env.local`, renseignez au minimum :

| Variable | Valeur locale conseillée |
|---|---|
| `DATABASE_URL` | `postgres://kivmo:kivmo@localhost:5432/kivmo` |
| `SESSION_SECRET` | 32 caractères aléatoires ou plus (`openssl rand -hex 32`) |
| `APP_URL` | `http://localhost:3000` |
| `EMAIL_PROVIDER` | `console` (le lien de connexion s'affiche à l'écran et dans la console) |
| `DEMO_MODE` | `on` |
| `BANK_ENVIRONMENT` | `sandbox` |
| `BANK_WEBHOOK_SECRET` | une valeur aléatoire |

## Base de données

```bash
createuser -P kivmo            # mot de passe : kivmo (local uniquement)
createdb -O kivmo kivmo
createdb -O kivmo kivmo_test   # utilisée et réinitialisée par les tests
DATABASE_URL=postgres://kivmo:kivmo@localhost:5432/kivmo npm run db:migrate
```

Les migrations sont dans `drizzle/`. Après une modification de `src/db/schema.ts` : `npm run db:generate`, puis `npm run db:migrate`.

## Lancer

```bash
npm run dev        # http://localhost:3000
```

- **Démo sans compte** : bouton « Découvrir en mode démo » sur l'accueil. Le compte est fictif, marqué comme tel partout, jamais fusionné avec un compte réel, et purgé par `POST /api/cron/purge-demo`.
- **Compte réel** : `/connexion`, saisissez une adresse ; en mode `console`, le lien à usage unique s'affiche directement.
- **Modèle du §20** : `/onboarding?modele=captur` (véhicule, référence diesel 6 L/100 km, projet « Mon prochain voyage », sans achat ni prix inventés) et `/simulations?modele=captur` (essence 6 L/100, E85 +25 %, conversion 360 €, 25 000 km/an).
- **Administration** : réservée aux comptes marqués administrateurs :
  `update users set is_platform_admin = true where email = '…';`

## Tests

```bash
npm run typecheck
npm run lint
npm test                                   # unitaires + intégration (TEST_DATABASE_URL, réinitialisée)
npm run build && npm run test:e2e          # parcours navigateur à 360 px, 390 px et bureau
```

Les parcours navigateur démarrent l'application construite sur le port 3100 et utilisent la base
`E2E_DATABASE_URL` (par défaut `postgres://kivmo:kivmo@localhost:5432/kivmo_e2e`, à créer une fois).

## Tâches planifiées

Les points d'entrée `cron` exigent l'en-tête `Authorization: Bearer $CRON_SECRET` :

| Point d'entrée | Rôle | Fréquence conseillée |
|---|---|---|
| `POST /api/cron/import-prices?department=75` | import du flux public des prix (si activé) | toutes les 10 à 30 min par zone |
| `POST /api/cron/reconcile` | rapprochement des ordres de virement incertains | toutes les 5 min |
| `POST /api/cron/purge-demo` | suppression des comptes de démonstration de plus de 24 h | toutes les heures |
