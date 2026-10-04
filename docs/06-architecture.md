# 06 · Architecture technique

## Vue d'ensemble

```
Navigateur (Next.js, PWA)
   │  HTTPS  /api/v1/…  (JSON, JWT Bearer)
   │  WSS    /ws/orders/ (jeton dans le premier message)
   ▼
Uvicorn + Django Channels (ASGI)
   ├── Django REST Framework  → PostgreSQL
   ├── Channels               → Redis (groupes restaurant_<id>, client_<id>, admin_orders)
   ├── Web Push (pywebpush)   → navigateurs abonnés
   ├── SMTP                   → e-mails
   └── Cloudinary             → images
```

Tout le rendu est côté client : le backend ne sert que du JSON, des fichiers média en
développement, l'administration Django et la documentation OpenAPI (`/api/docs/`).

## Backend

### Applications Django

| Application | Modèles | Rôle |
|---|---|---|
| `accounts` | `User` (UUID, e-mail comme identifiant, rôle client / restaurateur / admin, téléphone et visibilité, indicateurs bloqué / vérifié / signalé) | Inscription, connexion JWT, profil, mot de passe, gestion des utilisateurs par l'admin |
| `restaurants` | `Restaurant`, `BusinessHours`, `Employee`, `Favorite`, `RestaurantPhoto`, `Report` | Fiche restaurant, statut, horaires, modes et frais de livraison, fidélité, contrat, équipe avec PIN, favoris, photos du lieu, signalements |
| `menus` | `Category`, `MenuItem`, `MenuItemOption`, `MenuItemPhoto`, `StockMovement`, `Supplier`, `Ingredient`, `RecipeLine`, `IngredientMovement` | Carte, disponibilité programmée, photos, stock par plat, ingrédients et recettes, fournisseurs, mouvements |
| `orders` | `Order`, `OrderItem`, `PromoCode`, `DailyClosure` | Commandes et ventes comptoir, cycle de vie, remises, avis, clôtures, rapports et exports |
| `notifications` | `PushSubscription` | Abonnements Web Push, envoi push et e-mails transactionnels |

### Modèle de commande

- `order_type` : `sur_place`, `emporter`, `livraison`, `comptoir` (réservé au restaurateur).
- `status` : `nouvelle` → `confirmee` → `en_cuisine` → `prete` → (`en_livraison` pour une
  livraison) → `recuperee` ; `annulee` possible jusqu'à `en_cuisine`. La transition est
  calculée par `Order.next_status` et appliquée par l'action `advance`, sous verrou de ligne.
- `number` : numéro court unique (4501, 4502…), calculé comme le plus grand numéro existant
  plus un, avec nouvel essai en cas de collision.
- Montants en `Decimal` : `total_price` (articles moins remise plus frais de livraison),
  `discount_amount` et `discount_label`, `delivery_fee` ; `subtotal` est dérivé.
- `payment_method` : `especes`, `carte`, `en_ligne` (réservé), vide si non précisé.
- Lien vers l'employé (PIN) qui a traité la dernière étape, note et commentaire du client,
  réponse du restaurateur.

### Services métier

| Module | Fonctions principales | Rôle |
|---|---|---|
| `apps/menus/stock.py` | `apply_movement`, `apply_ingredient_movement`, `consume_for_order`, `restore_for_order`, `check_availability`, `sync_availability`, `refresh_item_cost`, `stock_alerts`, `shopping_list` | Toute variation de stock passe ici : quantité mise à jour sous verrou, disponibilité du plat synchronisée, mouvement tracé, coût recalculé. Une commande ne peut pas rendre un stock négatif. |
| `apps/orders/promotions.py` | `loyalty_status`, `validate_promo`, `apply_discounts`, `release_promo` | Une seule remise par commande : code promo prioritaire, sinon récompense fidélité prête. Compteur d'utilisations incrémenté atomiquement avec plafond. |
| `apps/orders/reports.py` | `sales_summary`, `compare_with_previous`, `daily_stats`, `closure_data`, `customers_summary`, `export_csv`, `export_xlsx` | Journal, synthèses, comparaison avec la période précédente, clientèle, exports (cellules neutralisées contre les formules). |
| `apps/restaurants/models.py` | `Restaurant.open_state`, `is_open_now`, `delivery_quote`, `delivery_available_at`, `allows` | Ouverture effective (interrupteur et horaires du jour, fermeture après minuit gérée), devis de livraison (fixe ou par zone, gratuité, minimum), modes autorisés. |
| `apps/notifications/push.py`, `emails.py` | `send_push`, `notify_new_order`, `notify_order_status`, `order_confirmation`, `order_ready`, `password_reset` | Canaux indépendants : un échec de l'un n'empêche pas les autres. Les e-mails partent dans un fil séparé sauf `EMAIL_SYNC`. |

### Création d'une commande (`OrderCreateSerializer`)

1. Restaurant actif et ouvert (interrupteur et horaires), mode autorisé, retrait non passé
   (tolérance 30 minutes), adresse et créneau valides pour une livraison.
2. Transaction : verrou sur le restaurant, recomptage de la capacité du créneau, création
   de la commande et de ses lignes (prix et options figés), remise, devis de livraison,
   consommation du stock (plats et ingrédients) sous verrou.
3. Après validation : WebSocket au restaurant et au client, push au restaurateur, e-mail de
   confirmation au client.

### Temps réel

- Middleware ASGI `JWTAuthMiddleware` et consumer `OrderConsumer` (`apps/orders/consumers.py`).
- Le client ouvre `/ws/orders/`, puis envoie `{"type": "auth", "token": "<access>"}`. Le
  serveur ferme après 10 secondes sans authentification (code 4001) ou sur jeton invalide.
  Le paramètre `?token=` reste accepté pour les anciennes versions installées.
- Groupes : `restaurant_<id>` (propriétaire), `client_<id>`, `admin_orders`. Événements
  `new_order` et `status_update` avec la commande sérialisée. `ping` / `pong` pour garder la
  connexion.
- Sans Redis, la couche en mémoire ne fonctionne qu'avec un seul processus.

### Tâches planifiées

Commandes de gestion : `stock_digest` (e-mail des stocks bas), `weekly_report` (bilan du
lundi), `generate_vapid_keys` (clés push), `create_admin` (compte admin au démarrage).
Les deux premières acceptent `--dry-run`.

### Réglages notables

- Fuseau `Europe/Brussels`, `USE_TZ` activé : toutes les règles horaires utilisent
  `timezone.localtime()`.
- JWT : accès 30 minutes, rafraîchissement 7 jours avec rotation et liste noire.
- Limites de débit : anonymes 100/heure, connectés 1000/heure, réinitialisation de mot de
  passe 5/heure, déverrouillage PIN 30/minute.
- `settings_prod.py` est chargé automatiquement sur Render : `DEBUG` forcé à faux,
  `SECRET_KEY` obligatoire, HSTS, cookies sécurisés, WhiteNoise pour les statiques, journaux
  vers la console.

## Frontend

### Pages

| Route | Fichier | Contenu |
|---|---|---|
| `/` | `app/page.jsx` | Site client : accueil, recherche, page publique, restaurant et carte, panier, suivi, profil, historique. Écrans gérés par un état `page` synchronisé avec l'URL (`#restaurant`, `#cart`…). |
| `/login` | `app/login/page.jsx` | Connexion, inscription client ou restaurateur, création du restaurant, mot de passe oublié, reprise d'une session ouverte. |
| `/reset` | `app/reset/page.jsx` | Nouveau mot de passe depuis le lien reçu par e-mail. |
| `/dashboard` | `app/dashboard/page.jsx`, `management.jsx`, `ingredients.jsx`, `shared.jsx` | Tableau de bord restaurateur et mode caissier. |
| `/admin` | `app/admin/page.jsx` | Console d'administration. |

Les styles sont écrits dans une constante `CSS` par page, complétée par
`lib/touch.css.js` (règles tactiles communes : champs à 16 px, cibles de 40 px, tableaux
défilants, grilles sur 320 px).

### Bibliothèque `lib/`

| Fichier | Rôle |
|---|---|
| `api.js` | Client HTTP unique : en-tête JWT, rafraîchissement automatique sur 401 avec rotation du jeton et protection contre les onglets concurrents, trois tentatives sur erreur réseau ou 502/503/504, `ensureFreshToken` pour le WebSocket, helpers `authApi`, `restaurantApi`, `menuApi`, `orderApi`. |
| `AuthContext.js` | Utilisateur courant lu du stockage local, `login`, `logout`, `getHomeRoute` par rôle. |
| `useWebSocket.js` | Connexion temps réel avec authentification par message, reconnexion à délai croissant, sondage de secours de la commande suivie. |
| `useHistoryPage.js` | Lie l'écran courant à l'historique du navigateur : bouton Retour du téléphone et restauration de l'écran au rechargement. |
| `hours.js` | Ouverture effective côté client et heure « du restaurant » (`localNow`, `todayLocalISO`) quel que soit le fuseau de l'appareil. |
| `ticket.js` | Tickets 80 mm (cuisine et client) imprimés via un cadre caché, préférences d'impression automatique. |
| `push.js` | Enregistrement du service worker, abonnement et désabonnement Web Push, notification de test. |
| `hooks.js` | `useRestaurants`, `useCreateOrder`. |

### Composants partagés

`Lightbox.jsx` (visionneuse plein écran : flèches, balayage, clavier), `InputGuard.jsx`
(filtrage à la saisie des champs numériques et téléphone), `PushToggle.jsx`, `PwaRegister.jsx`.

### PWA

`public/manifest.webmanifest` (installable, icônes maskable, raccourcis), `public/sw.js`
(réception des notifications push et ouverture de la bonne page au clic ; pas de cache hors
ligne). Le viewport déclare `viewport-fit=cover` et les barres fixes respectent les zones
sûres des encoches.

### Persistance côté navigateur

| Clé | Stockage | Contenu |
|---|---|---|
| `access`, `refresh`, `user` | localStorage | Session |
| `pickeatgo_session` | localStorage | Panier, restaurant ouvert, mode, adresse, note |
| `pickeatgo_order_*` | localStorage | Commande en cours de suivi |
| `pickeatgo_print_prefs` | localStorage | Impression automatique (tablette) |
| `pickeatgo_staff` | sessionStorage | Mode caissier actif et employé identifié |
| `pickeatgo_view_client` | sessionStorage | Restaurateur consultant volontairement le site client |
