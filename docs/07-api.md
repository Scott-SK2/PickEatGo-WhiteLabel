# 07 · Référence API

Base : `https://<api>/api/v1/`. Format JSON, sauf les envois d'images (`multipart/form-data`)
et les exports. Authentification par en-tête `Authorization: Bearer <access>`. La
documentation OpenAPI générée est servie sur `/api/docs/` (schéma sur `/api/schema/`).

Conventions des tableaux : **P** public, **C** connecté (tout rôle), **O** propriétaire du
restaurant (ou admin), **A** admin. Les listes sont paginées (`page`, `page_size`, 500
maximum sur les listes de gestion) et renvoient `{count, next, previous, results}`.

## Erreurs

| Code | Corps | Cas |
|---|---|---|
| 400 | `{"champ": ["message"]}` ou `["message"]` ou `{"detail": "…"}` | Validation |
| 401 | `{"detail": "…", "code": "token_not_valid"}` | Jeton absent, expiré ou invalide |
| 403 | `{"detail": "Permission refusée."}` | Rôle ou propriété insuffisants |
| 404 | `{"detail": "…"}` | Ressource absente ou invisible pour l'appelant |
| 405 | `{"detail": "…"}` | Modification directe d'une commande |
| 429 | `{"detail": "…"}` | Limite de débit atteinte |

## Marque et mode de l'instance (`branding/`) — édition Marque Blanche

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `` | P | `mode` (`platform` / `single`), `timezone`, `powered_by_badge`, `configured`, `restaurant` (détail public du restaurant lié, carte comprise, mode single), `brand` (nom, nom court, slogan, texte d'accueil, URL des icônes et de l'image de partage, réseaux, mentions légales, textes), `publication`. Cache 60 s. |
| PATCH | `` | O / A (mode single) | Champs de marque : `app_name` (40), `short_name` (12), `tagline` (120), `welcome_text` (300), `social_links` ({facebook, instagram, tiktok, website} : URL http(s)), `legal_name`, `company_number`, `vat_number`, `legal_address`, `publisher`, `terms_text`, `privacy_text`, `sender_name`. Renvoie le même corps que GET. 404 en mode plateforme. |
| POST | `icons/` | O / A (mode single) | multipart `image` (+ `kind=icons`, défaut) → icônes 192, 512 et maskable ; `source=logo` → génération depuis le logo ; `kind=share` → image de partage 1200 × 630. |
| GET | `instance/` | A | Fiche technique de l'instance : licencié, domaine, version, services, activité, journal récent. |

En mode single : les listes de restaurants ne renvoient que le restaurant lié (autre identifiant → 404),
`POST restaurants/` → 403, `validate` / `suspend` / `contract` → 403, `register` refuse le rôle restaurateur (400).

## Santé

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `health/` | P | `{"status": "ok"}` sans toucher à la base. Sert au réveil et à la supervision. |

## Authentification et comptes (`auth/`)

| Méthode | Route | Accès | Corps / effet |
|---|---|---|---|
| POST | `register/` | P | `email, password, password2, first_name, last_name, phone, phone_visible, role` (`client` ou `restaurateur` seulement). Renvoie `user`, `access`, `refresh`. |
| POST | `login/` | P | `email, password` → `access`, `refresh`, `user`. |
| POST | `refresh/` | P | `refresh` → nouveaux `access` et `refresh` (rotation, l'ancien est révoqué). |
| POST | `logout/` | C | `refresh` → révocation. |
| GET / PATCH | `me/` | C | Profil. `role`, `is_active` et `email` ne sont pas modifiables. |
| POST | `change-password/` | C | `old_password, new_password`. |
| POST | `password-reset/` | P (5/heure) | `email` → e-mail avec lien, réponse identique que l'adresse existe ou non. |
| POST | `password-reset/confirm/` | P | `uid, token, new_password`. |
| GET | `users/` | A | Liste des utilisateurs. |
| GET / PATCH / DELETE | `users/{id}/` | A | Blocage via `is_active`, suppression. |

## Restaurants (`restaurants/`)

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `` | P | Liste. Filtres `status, is_open, is_featured, city, owner`, recherche `search`, tri `ordering` (`avg_rating, total_orders, created_at, name`). Le public ne voit que les restaurants actifs ; un propriétaire voit aussi le sien ; l'admin voit tout. |
| POST | `` | C restaurateur | Création, statut « en attente », quatre catégories par défaut. |
| GET | `{id}/` | P | Détail avec horaires, galerie, catégories et plats. Les champs de contrat, de facturation et l'e-mail du propriétaire sont omis sauf pour l'admin et le propriétaire. |
| PATCH | `{id}/` | O | Profil, images, modes et frais de livraison, fidélité, mentions du ticket. Le statut, la mise en avant et le contrat ne sont modifiables que par l'admin. |
| DELETE | `{id}/` | A | Suppression. |
| PATCH | `{id}/validate/`, `{id}/suspend/` | A | Changement de statut. |
| PATCH | `{id}/toggle-open/` | O | Bascule l'interrupteur ; renvoie `is_open, is_open_now, open_status`. |
| POST | `{id}/upload-logo/` | O | multipart `logo` → `logo_url`. |
| GET / PUT | `{id}/hours/` | O | Liste `[{day_of_week (0 = lundi), is_open, open_time, close_time}]`. |
| GET / PATCH | `{id}/contract/` | A | Contrat et facturation. |
| GET | `{id}/reviews/` | P | Avis publics avec réponses. |
| POST | `{id}/photos/` | O | multipart `image` (+ `caption`) : photo du lieu, 10 maximum ; la première devient bannière. |
| PATCH / POST / DELETE | `{id}/photos/{photo_id}/` | O | Légende / définir bannière / retirer. |
| GET | `favorites/` | C | Identifiants des restaurants favoris. |
| POST | `{id}/favorite/` | C | Ajoute ou retire ; renvoie `is_favorite`. |

Champs en lecture utiles : `is_open_now`, `open_status` (« Ouvert · ferme à 22:00 »),
`delivery_schedule_label`, `logo_url`, `banner_url`, `gallery`, `hours`.

### Équipe (`restaurants/employees/`)

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET / POST | `?restaurant=<id>` | O | Liste et création (`name, role` caissier / cuisine / gérant, `pin` 4 à 6 chiffres, `is_active`). |
| PATCH / DELETE | `{id}/` | O | Modification (nouveau `pin` possible) et suppression. |
| POST | `unlock/` (30/min) | O | `{restaurant, pin, purpose: "enter"|"exit"}` → `{employee, locked}`. `exit` n'accepte que les gérants. |

### Signalements (`restaurants/reports/`)

CRUD standard ; un utilisateur voit ses propres signalements, l'admin tous. `status` et
`severity` ne sont modifiables que par l'admin. `PATCH {id}/resolve/` (admin) marque résolu.

## Menus (`menus/`)

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `categories/?restaurant=<id>` | P | Catégories actives avec plats et options. |
| POST / PATCH / DELETE | `categories/`, `categories/{id}/` | O | Propriété vérifiée à la création et à la modification. |
| GET | `items/?restaurant=<id>` | P | Plats. Recherche `search` (nom, description, allergènes), tri `price, order, name, created_at`. |
| POST / PATCH / DELETE | `items/`, `items/{id}/` | O | `name, price, description, category, options, cost_price, stock_qty, low_stock_threshold, available_days, available_from, available_until, available_on, allergens, is_available`. |
| POST | `items/{id}/upload-image/` | O | multipart `image` → photo principale (identifiant unique à chaque envoi). |
| DELETE | `items/{id}/delete-image/` | O | Retire la photo principale. |
| POST | `items/{id}/photos/` | O | Photo supplémentaire (5 au total). |
| POST / DELETE | `items/{id}/photos/{photo_id}/` | O | Définir principale / retirer. |
| PATCH | `items/{id}/toggle-availability/` | O | Bascule disponible / indisponible. |
| POST | `items/{id}/stock/` | O | `{"mode": "set", "qty": 20}` inventaire ; `{"mode": "add", "qty": 10}` réapprovisionnement (négatif = ajustement) ; `{"track": false}` arrêt du suivi. |
| POST | `items/{id}/waste/` | O | `{"qty": 3, "note": "…"}` perte valorisée au prix de revient. |
| GET / PUT | `items/{id}/recipe/` | O | `{"lines": [{"ingredient": "<uuid>", "qty": 0.15}]}` ; renvoie lignes, coût matière, portions réalisables. |
| GET | `items/stock-alerts/?restaurant=<id>` | O | Plats et ingrédients épuisés ou sous le seuil. |
| GET | `stock-movements/?restaurant=<id>[&item=&reason=&from=&to=]` | O | Historique des mouvements de plats. |
| GET / POST / PATCH / DELETE | `suppliers/`, `suppliers/{id}/` | O | Fournisseurs (`?restaurant=<id>`). |
| GET / POST / PATCH / DELETE | `ingredients/`, `ingredients/{id}/` | O | `name, unit (g, kg, ml, l, pc), stock_qty, low_stock_threshold, unit_cost, supplier, reorder_qty, is_active`. |
| POST | `ingredients/{id}/stock/` | O | `{"mode": "set"|"add", "qty", "note", "unit_cost"}`. |
| POST | `ingredients/{id}/waste/` | O | `{"qty", "note"}`. |
| GET | `ingredients/alerts/?restaurant=<id>` | O | Ingrédients sous le seuil. |
| GET | `ingredients/shopping-list/?restaurant=<id>[&type=csv]` | O | Liste de courses par fournisseur. |
| GET | `ingredient-movements/?restaurant=<id>[&ingredient=&reason=&from=&to=]` | O | Historique des ingrédients. |

Champs en lecture d'un plat : `image_url`, `image_urls`, `photos`, `is_out_of_stock`,
`is_low_stock`, `effective_stock`, `portions_available`, `limited_by`, `is_scheduled`,
`is_available_today`, `schedule_label`, `recipe_cost`, `recipe` (propriétaire).

## Commandes (`orders/`)

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `` | C | Ses commandes (client), celles de son restaurant (restaurateur), toutes (admin). Filtres `status, order_type, restaurant, pickup_date, client`, tri `created_at, pickup_slot, total_price`. |
| POST | `` | C | `restaurant, order_type, pickup_date, pickup_slot, note, promo_code, delivery_address, delivery_postcode, items: [{menu_item_id, qty, options: [id]}]`. |
| GET | `{id}/` | C | Détail (visible selon le rôle). |
| PUT / PATCH / DELETE | `{id}/` | | Refusés (405) : une commande évolue par ses actions. |
| PATCH | `{id}/advance/` | O | Étape suivante ; `payment_method` (`especes`, `carte`, `""`) et `employee` facultatifs. Verrouillé contre le double clic. |
| PATCH | `{id}/cancel/` | C / O | Client : seulement « nouvelle ». Restaurateur : jusqu'à « en cuisine ». Stock et promo restitués. |
| POST | `{id}/rate/` | C | `{"rating": 1-5, "comment"}` une fois par commande récupérée. |
| POST | `{id}/reply/` | O | `{"reply": "…"}` réponse publique (vide = retirer). |
| POST | `counter/` | O | Vente comptoir : `{restaurant, items, payment_method, note, promo_code, employee}` ; créée au statut « récupérée ». |
| GET | `sales/?restaurant=&from=&to=&group=day|week|month` | O | Journal, synthèse, comparaison avec la période précédente. |
| GET | `sales/export/?restaurant=&from=&to=&type=csv|xlsx` | O | Export tableur. |
| GET | `customers/?restaurant=&search=&ordering=[&type=csv]` | O | Clientèle ; coordonnées seulement si partagées. |
| GET | `stats/?restaurant=&days=7` | O | Activité quotidienne pour les graphiques. |
| GET | `reviews/?restaurant=<id>` | O | Avis reçus avec réponses. |
| GET | `loyalty/?restaurant=<id>` | C | Carte de fidélité du client : progression, récompense prête. |
| POST | `promo/check/` | C | `{restaurant, code, subtotal}` → `code, label, discount, total` ou erreur. |
| POST | `delivery/quote/` | P | `{restaurant, postcode, subtotal}` → `fee, free, min_order, below_min, free_above` ou motif de refus. |
| GET / POST / PATCH / DELETE | `promos/`, `promos/{id}/` (`?restaurant=<id>`) | O | `code, kind (percent, amount), value, label, min_order, starts_at, ends_at, max_uses, is_active`. |
| GET / POST | `closures/?restaurant=<id>` | O | Clôtures de journée ; POST `{restaurant, date, note}` fige les chiffres. |
| GET | `closures/preview/?restaurant=&date=` | O | Chiffres du jour avant clôture. |

## Notifications (`notifications/`)

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `push/key/` | P | `{enabled, public_key}`. |
| GET / POST / DELETE | `push/subscription/` | C | État de l'abonnement de cet appareil (`?endpoint=`), enregistrement (`PushSubscription.toJSON()`), suppression. |
| POST | `push/test/` | C | Envoie une notification de test à l'utilisateur. |

## WebSocket

- URL : `wss://<api>/ws/orders/`.
- Premier message client : `{"type": "auth", "token": "<access>"}`. Réponse
  `{"type": "connection_established", "groups": [...]}` ou `{"type": "auth_failed"}` puis
  fermeture 4001. Sans message d'authentification dans les 10 secondes, fermeture 4001.
- Messages serveur : `{"type": "new_order", "order": {...}}` (restaurateur et admin),
  `{"type": "status_update", "order": {...}}` (restaurateur, client concerné, admin).
- `{"type": "ping"}` → `{"type": "pong"}`.

## Limites et tailles

- Images : JPEG, PNG ou WebP, 5 Mo maximum ; 5 photos par plat, 10 photos du lieu.
- Commentaire d'avis : 1000 caractères ; légende de photo : 80 ; message de livraison : 200.
- Débit : anonymes 100 requêtes/heure, connectés 1000/heure, réinitialisation 5/heure,
  PIN 30/minute.
