# 09 · Tests et qualité

> Édition Marque Blanche : la suite s'exécute dans les deux modes. `pytest` = mode plateforme ;
> `PICKEATGO_TEST_MODE=single pytest --no-cov --create-db` = mode mono-restaurant (l'instance est liée
> au restaurant de la fixture `restaurant` ; les tests marqués `platform_only` sont ignorés).
> `tests/test_single_mode.py` couvre `/branding/`, les icônes, les règles du mode single, les messages
> sous la marque, `bootstrap_tenant`, les vérifications de démarrage et la fiche d'instance.
> L'intégration continue enchaîne les deux modes puis amorce une instance de test.

## Suite backend

```
cd backend
pytest                       # avec couverture (seuil 60 %, actuellement ≈ 86 %)
pytest -q --no-cov           # plus rapide
pytest tests/test_security.py
```

Configuration dans `backend/pytest.ini` (base réutilisée, couverture HTML dans `htmlcov/`).
Sans `DATABASE_URL`, les tests utilisent SQLite ; en intégration continue, PostgreSQL et
Redis. Les fixtures communes (`api_client`, `client_user`, `restaurateur_user`,
`admin_user`, `restaurant`) sont dans `backend/conftest.py`.

| Fichier | Ce qui est couvert |
|---|---|
| `test_suite.py` | Inscription, connexion, restaurants, menus, commandes de base, avancement, annulation |
| `test_security.py` | Escalade de rôle, commandes non modifiables, isolation entre restaurants, champs privés, retrait passé, numérotation, stock non négatif, plafond promo |
| `test_open_state.py` | Ouverture effective : interrupteur, horaires, fermeture après minuit, refus hors horaires |
| `test_delivery.py` | Modes activables, règles de livraison, frais fixes et par zone, statut « en livraison » |
| `test_promotions.py` | Fidélité et codes promo |
| `test_management.py` | Stock par plat, ventes comptoir, journal, clôture, exports |
| `test_ingredients.py` | Ingrédients, recettes, consommation, liste de courses |
| `test_schedule.py` | Disponibilité programmée des plats |
| `test_employees.py` | Équipe, PIN, déverrouillage, traçabilité |
| `test_client_features.py` | Favoris, avis, réponses, historique |
| `test_photos.py`, `test_restaurant_gallery.py` | Photos des plats et du lieu |
| `test_push.py`, `test_accounts_extra.py` | Web Push, mot de passe, réinitialisation |
| `test_websocket.py` | Authentification WebSocket par message, refus, compatibilité URL |

Les tests qui créent des commandes utilisent le créneau `23:59` du jour, toujours dans le
futur quelle que soit l'heure d'exécution.

## Intégration continue

`.github/workflows/ci.yml` à chaque push et pull request sur `main` :

1. Tests Django avec PostgreSQL et Redis : `manage.py check`, contrôle des migrations
   (`makemigrations --check`), `pytest`.
2. Build Next.js.

## Frontend

```
cd frontend
npm run build                # compilation stricte, échoue sur toute erreur
npm run lint
```

Il n'y a pas de tests unitaires frontend ; la vérification se fait par scénarios de bout en
bout sur un backend local avec les données de démonstration.

## Données de démonstration

`tools/seed_demo.py` crée un restaurant complet (Burger House : catégories, plats avec
photos générées, options, allergènes, horaires, ingrédients et recettes, employés, codes
promo, zones de livraison, commandes à différents statuts, avis) et trois comptes de test
(voir 02 · Installation). À exécuter depuis `backend/` avec
`python manage.py shell < ../tools/seed_demo.py`. Réservé au développement.

## Harnais responsive

`tools/audit-responsive.js` charge chaque écran de l'application (client, tableau de bord,
mode caissier, admin, connexion) sur une grille d'appareils émulés et mesure :

- débordement horizontal de la page et éléments visibles dépassant l'écran ;
- boutons et liens dont la zone tactile fait moins de 32 px ;
- champs de saisie de moins de 16 px (déclenchent le zoom automatique sur iOS) ;
- erreurs JavaScript.

Appareils : Android 320 px, Galaxy S8, iPhone SE, iPhone 14, Pixel 7, iPhone Max,
téléphone en paysage, iPad mini, iPad paysage, iPad Pro, portable, bureau.

```
# backend sur :8000 avec les données de démonstration, frontend `next start` sur :3000
node tools/audit-responsive.js sortie
DEVICES=iphone-se,ipad-mini ONLY=dash-home,client-cart-delivery node tools/audit-responsive.js sortie
```

Le dossier de sortie contient une capture par écran et par appareil et `report.json` avec
le détail des éléments signalés. Le harnais requiert Playwright et Chromium. Les cases à
cocher de 22 px sont signalées mais acceptées (libellé cliquable).

## Règles de qualité appliquées

- Tout montant est un `Decimal` côté serveur ; le frontend n'additionne jamais des chaînes.
- Toute variation de stock passe par `apps/menus/stock.py`.
- Toute requête frontend passe par `lib/api.js` (jeton, renouvellement, nouvelles tentatives).
- Les libellés sont en français, sans code technique dans les messages d'erreur affichés.
- Les commits sont vérifiés par `pytest` et `next build` avant envoi.
