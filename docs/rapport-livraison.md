# Rapport de livraison KIVMO

Date : 16 novembre 2026. Dépôt : `sylvainschietse/kivmo`.

## Ce qui est livré

Une application web responsive et installable (PWA), en français, construite avec Next.js 16 (App Router),
React 19, TypeScript, Tailwind CSS 4, PostgreSQL 16 et Drizzle ORM. Tous les montants et volumes sont
calculés en décimal exact.

| Domaine | Écrans |
|---|---|
| Accueil et onboarding (avec le modèle Captur du §20) | `/accueil`, `/onboarding` |
| Saisie d'un plein : deux valeurs sur trois, mélange, remise, ticket privé, station proche ou recherchée, prix daté prérempli, dictée, doublons, hors ligne | `/pleins/nouveau`, `/pleins/[id]` |
| Garage : véhicules, références versionnées, conversion et amortissement, compteur remplacé, entretien et échéances | `/garage`, `/garage/nouveau`, `/garage/[id]` |
| Historique filtrable et exports CSV/PDF | `/historique` |
| Analyses : graphiques avec tableaux équivalents, intervalles plein à plein, alerte de dérive | `/analyses` |
| Simulations : conversion E85 (seuil de prix, amortissement prévisionnel), coût total multi-énergies | `/simulations` |
| Stations : prix officiels datés, fraîcheur, disponibilité en 4 états, filtres, favoris, signalements modérés, liens GPS, offres sponsorisées séparées | `/stations`, `/stations/[id]` |
| Trajets : rentabilité d'un détour, estimation de voyage | `/trajets` |
| Projets et épargne : 4 valeurs distinctes, répartition, affectation sans double comptage, virements déclarés, banque en bac à sable, règle d'épargne | `/projets`, `/projets/epargne`, `/projets/epargne/bac-a-sable` |
| Entreprise : organisations, rôles, invitations, équipes, affectations, tableau de bord, budgets, validations, remboursements, périodes clôturées, exports comptables | `/entreprise`, `/entreprise/[orgId]/…`, `/invitation` |
| Partenaires : annuaire vérifié, devis consenti nominativement (3 maximum), retrait du consentement, espace professionnel | `/partenaires`, `/espace-pro/[orgId]` |
| Compte : profil, thème, notifications, consentements, parrainage, export et suppression | `/profil`, `/notifications` |
| Administration : santé des intégrations, import des prix, modération, vérification des professionnels, audit | `/admin` |
| État public des services | `/integrations` |

La correspondance complète exigences ↔ écrans ↔ tables ↔ API ↔ tests est dans [`matrice-exigences.md`](matrice-exigences.md).

## Services : connectés, bac à sable, à connecter

| Service | État | Ce qui fonctionne aujourd'hui | Pour le connecter |
|---|---|---|---|
| Liens de connexion par e-mail | **Local** en développement, **à configurer** en production | lien affiché à l'écran (`EMAIL_PROVIDER=console`) ; envoi SMTP implémenté | `EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM` |
| Prix des carburants (flux public prix-carburants) | **À activer** | importeur paginé, idempotent, avec reprise et journal, testé sur un extrait réel du flux ; derniers prix datés conservés ; saisie manuelle toujours possible | `FUEL_PRICES_SOURCE=prix-carburants` après vérification des conditions de réutilisation, puis planifier `POST /api/cron/import-prices` |
| Banque et virements | **Bac à sable** | connexion, consentement, révocation, ordres, autorisation simulée, webhooks signés anti-rejeu, rapprochement, timeout, idempotence ; aucun argent ne bouge | choisir un prestataire agréé (initiation de paiement DSP2), écrire l'adaptateur `BankProvider` (`src/integrations/bank.ts`) |
| Épargne automatique | **À connecter** | refus explicite (« exige un prestataire et une banque compatibles ») | dépend du prestataire bancaire |
| Fond de carte | **À connecter** | liste classée, distances à vol d'oiseau identifiées, liens Google Maps, Waze, Plans, OpenStreetMap | choisir un fournisseur de tuiles (licence, quotas, attribution), ajouter le composant de carte |
| Itinéraire routier | **À connecter** | aucune distance routière inventée ; saisie manuelle des kilomètres | adaptateur `RoutingProvider` (`src/integrations/routing.ts`) |
| Lecture des photos (compteur, pompe, ticket, carte grise) | **Branché** (actif dès que `ANTHROPIC_API_KEY` est renseignée) | formulaire manuel | service de vision Claude (`src/integrations/ocr.ts`, route `/api/scan`) ; valeurs proposées, surlignées, toujours vérifiées avant enregistrement |
| Notifications push | **À connecter** | centre de notifications dans l'application, préférences, plafond quotidien | clés VAPID et service d'envoi |
| Facturation professionnelle | **À connecter** | abonnements suivis sans aucun tarif inventé | prestataire de paiement et grille tarifaire |
| Recherche par immatriculation | **À connecter** | saisie manuelle du véhicule | fournisseur autorisé |

L'état de chaque service est visible dans l'application (`/integrations`, pastilles sur les écrans concernés).
Une configuration partielle n'est jamais présentée comme active : un service sans adaptateur réel reste « À connecter ».

## Tests exécutés

| Suite | Commande | Résultat |
|---|---|---|
| Types | `npm run typecheck` | OK |
| Lint | `npm run lint` | OK, 0 avertissement |
| Unitaires (moteur de calcul, recettes §18) | `npm test` | 42 tests OK |
| Intégration PostgreSQL (droits, isolation, idempotence, webhooks, périodes, devis, RGPD) | `npm test` | 33 tests OK |
| Build de production | `npm run build` | OK |
| Parcours navigateur (Playwright) à 360 px, 390 px et bureau | `npm run test:e2e` | 18 parcours OK |

Les parcours navigateur couvrent : la démo et 13 écrans sans débordement horizontal, un virement fictif
complet (préparation, autorisation, confirmation), l'inscription par lien suivie d'un véhicule, de deux pleins
complets (6,00 L/100 km mesurés) et d'un export CSV, le refus de la géolocalisation avec repli sur la
recherche par ville, la file hors ligne, et l'isolation entre organisations (404 pour un non-membre).

Les parcours ont révélé trois défauts, corrigés et couverts par un test :
1. deux pleins saisis dans la même minute étaient mal ordonnés : départage désormais par le compteur ;
2. une banque qui annonce « exécuté » juste après l'autorisation forte provoquait une transition refusée :
   l'ordre passe maintenant par « soumis », avec une seule entrée d'épargne ;
3. des montants s'affichaient avec un point décimal dans certains messages : format français partout.

## Limites exactes

- **Aucun service externe réel n'est branché** dans cet environnement : la source officielle des prix était
  inaccessible depuis le réseau de développement, donc l'importeur n'a été validé que sur un extrait enregistré du flux.
- **Carte** : pas de carte interactive tant qu'un fournisseur de tuiles n'est pas choisi.
- **Bilan environnemental** : non livré, faute de facteurs d'émission documentés fournis.
- **Stockage des pièces jointes** : disque local privé (`STORAGE_DIR`) en local ; dans PostgreSQL sur Vercel
  (`STORAGE_BACKEND=db`). Un stockage objet privé reste préférable si les volumes grossissent.
- **Accessibilité** : clavier, focus visible, zones de 44 px, libellés, contrastes de la palette et animations
  réduites sont traités ; un audit WCAG 2.2 complet avec lecteur d'écran reste à mener.
- **Hors ligne** : la file de pleins est stockée sur l'appareil (30 jours) et envoyée seulement à la demande ;
  les autres écritures exigent le réseau.
- **Dictée** : dépend de la reconnaissance vocale du navigateur ; non testée automatiquement.
- **CSP** : en-têtes de sécurité en place, politique CSP stricte à définir avec l'hébergeur.
- **Nom « KIVMO »** : disponibilité de la marque et des domaines non vérifiée.

## Reproduire

Voir [`demarrage.md`](demarrage.md) (local, tests, tâches planifiées) et [`deploiement.md`](deploiement.md).
