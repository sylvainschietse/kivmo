# Matrice des exigences KIVMO

Lien entre chaque exigence du cahier des charges (§), les écrans, les tables, les points d'API et les tests.
État : ✅ livré et testé · 🟡 livré, dépend d'un service « À connecter » (contrat d'intégration + état visible + démonstration séparée) · ⏳ non livré (voir rapport de livraison).

Les chemins d'écrans sont ceux de l'application (`src/app`). Les tests : `U` = unitaires (`tests/unit`), `I` = intégration PostgreSQL (`tests/integration`), `E` = parcours navigateur (`tests/e2e`).

## Calculs (§7) — moteur `src/domain`

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Mesure plein à plein, achats du repère exclus, partiels inclus | `/accueil`, `/analyses`, `/pleins/[id]` | `fillups`, `fillup_lines`, `consumption_intervals` | `GET /api/analytics` | U recette A, B · I « A + B » | ✅ |
| D > 0, compteur identique, absence de repère : aucune mesure fabriquée | `/accueil` (encart), `/analyses` | `consumption_intervals.status/issues` | `GET /api/analytics` | U recette E | ✅ |
| Plein oublié / nouvelle référence / consommation implausible signalés | `/pleins/nouveau` (options), `/analyses` | `fillups.missed_before`, `starts_new_baseline` | `POST /api/fillups` | U « mélange, oubli » | ✅ |
| Mélange de carburants sur un même événement | `/pleins/nouveau` (lignes multiples) | `fillup_lines` | `POST /api/fillups` | U « mélange » | ✅ |
| Coût référence, gain, prix pondéré par litres, prix fixe de scénario | `/analyses`, `/garage/[id]` | `reference_profiles`, `comparison_results` | `GET /api/comparisons` | U recette A, pondération | ✅ |
| Instantané du prix de référence par achat ; prix manquant ⇒ « comparaison incomplète » | `/pleins/nouveau`, `/analyses` | `fillups.ref_price*` | `POST /api/fillups` | U recette E · I référence historisée | ✅ |
| Références historisées (versions, dates d'effet) | `/garage/[id]` | `reference_profiles.profile_version` | server action | I « référence historisée » | ✅ |
| Amortissement, gain net, solde à amortir, date initiale vs solde actuel, intervalle à cheval | `/accueil`, `/garage/[id]` | `conversions` | `GET /api/analytics` | U recette A, N | ✅ |
| Estimation E85 avant historique, seuil de prix, distance d'amortissement | `/simulations` | — | — | U recette C | ✅ |
| Arrondis à l'affichage, totaux non arrondis, moyenne pondérée, dates de fermeture, proratisation | `/analyses` | — | — | U « agrégats et arrondis » | ✅ |
| Saisie française (virgule décimale, espaces) | tous formulaires | — | — | U « saisie française » | ✅ |
| Montants en décimal exact | — | colonnes `numeric` | — | U (decimal.js) | ✅ |

## Saisie d'un plein (§6)

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Deux valeurs sur trois, divergence ⇒ choix de la valeur à corriger, remise séparée | `/pleins/nouveau` | `fillups.displayed_total/discount`, `fillup_lines` | `POST /api/fillups` | U « deux valeurs sur trois » · I « trois valeurs divergentes » | ✅ |
| Validation : date non future, litres > 0, compteur croissant (confirmable), capacité | `/pleins/nouveau` | — | `POST /api/fillups` | U validation · I compteur, date | ✅ |
| Doublons probables confirmables ; idempotence ; double clic | `/pleins/nouveau` | `fillups.idempotency_key` (unique) | `POST /api/fillups` (`Idempotency-Key`) | I idempotence parallèle, doublon probable | ✅ |
| Ticket privé, hash, jamais deux pleins par ticket | `/pleins/nouveau` | `attachments` (hash unique), index unique `fillups.receipt_attachment_id` | `POST /api/attachments`, `GET /api/fillups/[id]/receipt` | I « un ticket ne peut pas créer deux pleins » | ✅ |
| OCR ticket/compteur avec confiance par champ et confirmation | `/pleins/nouveau` | `attachments.ocr_result` | `POST /api/attachments` | — | 🟡 OCR à connecter (formulaire en repli) |
| Dictée facultative avec confirmation | `/pleins/nouveau` | — | — | E | ✅ (navigateurs avec reconnaissance vocale) |
| Géolocalisation à la demande, précision, refus, recherche par commune | `/pleins/nouveau`, `/stations` | — | `GET /api/stations/nearby` | E refus GPS | ✅ |
| Compteur remplacé (décalage historisé) | `/garage/[id]` | `odometer_events` | server action | I « compteur remplacé » | ✅ |
| Correction, suppression tracée, récapitulatif après enregistrement | `/pleins/[id]` | `audit_events`, `fillups.deleted_*` | `PATCH/DELETE /api/fillups/[id]` | I cas G | ✅ |
| Verrou optimiste | `/pleins/[id]` | `fillups.version` | `PATCH /api/fillups/[id]` | I « verrou optimiste » | ✅ |

## Stations et itinéraires (§8, §15)

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Liste + carte synchronisées, rayon, filtres (énergie, rupture, fraîcheur, enseigne, services, 24/24) | `/stations` | `stations`, `station_fuels`, `price_observations` | `GET /api/stations/nearby` | I cas L | ✅ liste · 🟡 fond de carte à connecter |
| Fiche : prix datés, provenance, disponibilité (4 états), vol d'oiseau identifié, GPS choisi | `/stations/[id]` | idem + `availability_reports` | `GET /api/stations/[id]` | I cas L | ✅ |
| Distances/durées routières | `/stations/[id]`, `/trajets` | — | `POST /api/routes/estimate` | — | 🟡 routage à connecter (aucune distance inventée) |
| Signalements communautaires : expiration, modération, anti-abus, sans écraser l'officiel | `/stations/[id]`, `/admin` | `availability_reports` | server action | I cas L | ✅ |
| Favoris | `/stations` | `favorite_stations` | server action | E | ✅ |
| Import du flux public prix-carburants côté serveur, cache, reprise, journal | `/admin` | `import_jobs`, `integration_health` | `POST /api/cron/import-prices` | I import fixture, panne source | 🟡 activable (conditions à vérifier) |
| Calcul de détour (gain net, volume de rentabilité) | `/trajets` | — | — | U recette D | ✅ |
| Voyages : étapes, autonomie, budget | `/trajets` | — | `POST /api/routes/estimate` | — | 🟡 routage à connecter (saisie manuelle des distances) |

## Historique, analyses, simulations (§9)

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Historique filtrable, recherche, export | `/historique` | `fillups` | `GET /api/fillups`, `GET /api/exports` | I filtres conducteur | ✅ |
| Graphiques avec tableaux équivalents, vues mensuelles | `/analyses` | — | `GET /api/analytics` | E | ✅ |
| Simulation multi-énergies (PHEV, EV, kWh séparés, charge gratuite) | `/simulations` | — | — | U simulation | ✅ |
| Alertes de dérive, écoconduite, bilan environnemental | `/analyses` | `notifications` | — | — | ✅ dérive (historique suffisant) · ⏳ bilan environnemental (facteurs documentés non fournis) |

## Projets et épargne (§10)

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Projets multiples, répartition %/montant, 4 valeurs distinctes | `/projets` | `projects`, `allocations`, `savings_entries` | `GET/POST /api/projects`, `POST /api/savings/allocations` | U + I cas H | ✅ |
| Aucune double affectation ; perte ⇒ capacité réduite sans reprise | `/projets` | verrou transactionnel | `POST /api/savings/allocations` | I cas H | ✅ |
| Virements déclarés (jamais « vérifiés ») | `/projets` | `savings_entries.kind` | server action | I cas H | ✅ |
| Connexion bancaire, consentement, révocation, capacités séparées | `/projets/epargne` | `bank_connections`, `consent_records` | `POST /api/bank/connections` | I cas F | ✅ bac à sable · 🟡 production à connecter |
| Machine d'états, idempotence, webhooks signés anti-rejeu, rapprochement, plafond/pause/arrêt serveur | `/projets/epargne` | `payment_orders`, `payment_events`, `sandbox_bank_payments` | `POST /api/bank/payment-orders`, `POST /api/bank/webhooks`, `POST /api/cron/reconcile` | I cas F (4 tests) | ✅ bac à sable |
| Épargne automatique | `/projets/epargne` | `savings_rules` | — | I « automatique ⇒ NOT_CONNECTED » | 🟡 exige partenaire + banque compatibles |

## Entreprise (§11)

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Organisation séparée, rôles, invitations expirables/révocables | `/entreprise/[orgId]/membres` | `organizations`, `memberships`, `invitations` | server actions | I invitations | ✅ |
| Contrôle serveur par ressource et pièce jointe | toutes | — | toutes | I cas I | ✅ |
| Affectations datées, ratio conducteur seulement avec relevés | `/entreprise/[orgId]` | `vehicle_assignments` | — | I cas K | ✅ |
| Tableau de bord (dépenses, litres, km documentés, coût/km, budgets, anomalies, pièces manquantes) | `/entreprise/[orgId]` | `budgets` | `GET /api/organizations/[id]/budgets` | I cas K | ✅ |
| Validation des pleins (soumis/à compléter/validé/rejeté avec raison), remboursement | `/entreprise/[orgId]/validations` | `approvals`, `fillups.approval_*` | `POST /api/approvals` | I validation | ✅ |
| Périodes ouvertes/clôturées, correction tracée, réouverture journalisée | `/entreprise/[orgId]/periodes` | `accounting_periods` | server actions | I cas J | ✅ |
| Exports CSV/PDF avec champs comptables configurables, sans TVA calculée | `/entreprise/[orgId]/exports` | `export_jobs` | `GET /api/exports` | I export conducteur | ✅ |
| Entretien, échéances, immobilisation | `/garage/[id]` | `maintenance_events`, `reminders` | server action | — | ✅ |

## Partenaires, notifications, communauté (§12, §13)

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Annuaire vérifié, devis consenti nominativement (≤ 3), suivi, retrait | `/partenaires` | `partners`, `quote_requests`, `request_recipients` | `POST /api/partners/quote-requests` | I devis | ✅ |
| Espace garage sans accès bancaire ni trajets | `/espace-pro/[orgId]` | — | — | I « autre garage refusé » | ✅ |
| Offres sponsorisées identifiées, classement indépendant | `/stations` | `sponsored_offers` | — | — | ✅ |
| Abonnements/licences, facturation | `/espace-pro/[orgId]` | `subscriptions` | — | — | 🟡 facturation à connecter, aucun tarif inventé |
| Notifications in-app, préférences, plafond quotidien, dédoublonnage | `/notifications`, `/profil` | `notifications`, `notification_preferences` | — | I (confirmation virement) | ✅ · 🟡 push à connecter |
| Parrainage sans accès aux données du filleul | `/profil` | `referral_events` | — | — | ✅ |

## Transverse (§5, §14, §16, §17)

| Exigence | Écran | Tables | API | Tests | État |
|---|---|---|---|---|---|
| Démo sans compte, isolée et identifiable, jamais fusionnée | `/` → `/demo` | `users.is_demo` | — | I « mode démonstration isolé » | ✅ |
| Connexion par lien email | `/connexion` | `auth_tokens`, `sessions` | — | I « lien à usage unique » | ✅ (console en dev) · 🟡 SMTP à configurer |
| Onboarding court, scénario préconfigurable (§20) | `/onboarding` | — | — | E | ✅ |
| Journal d'audit sans secrets | `/admin` | `audit_events` | — | I cas G, J | ✅ |
| Export / suppression de compte | `/profil` | — | `GET /api/account/export` | I RGPD | ✅ |
| Consentements séparés | `/profil` | `consent_records` | — | I devis, banque | ✅ |
| Hors ligne : file stable, synchronisation visible, aucun envoi à l'insu | `/pleins/nouveau`, bandeau | IndexedDB (client) | `POST /api/fillups` | E hors ligne | ✅ |
| États chargement/vide/erreur/session expirée/droits insuffisants | toutes | — | erreurs structurées | E | ✅ |
| Accessibilité (clavier, focus visible, 44 px, libellés, contraste, animations réduites) | toutes | — | — | E | ✅ ciblé, audit WCAG complet à mener |
