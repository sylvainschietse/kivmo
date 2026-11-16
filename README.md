# KIVMO

**Roulez. Économisez. Réalisez vos projets.**

Application web responsive et installable (PWA) : suivi des pleins, consommation mesurée plein à plein,
économies face à une référence, amortissement d'une conversion E85, stations et prix datés, projets
d'épargne, espace flotte pour indépendants et entreprises, partenaires.

> Nom de travail : disponibilité commerciale du nom, des domaines et de la marque non vérifiée.

## Démarrage rapide

Prérequis : Node.js 22+, PostgreSQL 16+.

```bash
cp .env.example .env.local          # puis renseigner SESSION_SECRET
npm ci
createdb kivmo                       # ou via votre outil PostgreSQL
DATABASE_URL=postgres://kivmo:kivmo@localhost:5432/kivmo npm run db:migrate
npm run dev                          # http://localhost:3000
```

## Tests

```bash
npm run typecheck && npm run lint
npm test                             # unitaires + intégration (base TEST_DATABASE_URL réinitialisée)
npm run build && npm run test:e2e    # parcours navigateur 360 px, 390 px et bureau
```

## Documentation

- [`docs/rapport-livraison.md`](docs/rapport-livraison.md) : ce qui est livré, services connectés ou « À connecter », tests, limites.
- [`docs/matrice-exigences.md`](docs/matrice-exigences.md) : exigences ↔ écrans ↔ tables ↔ API ↔ tests.
- [`docs/demarrage.md`](docs/demarrage.md) : installation locale, démo, tests, tâches planifiées.
- [`docs/deploiement.md`](docs/deploiement.md) : mise en production.
