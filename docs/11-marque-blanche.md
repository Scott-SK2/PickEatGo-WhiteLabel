# 11 · Édition Marque Blanche (mode mono-restaurant)

PickEatGo et l'édition Marque Blanche sont **le même logiciel**, dans deux modes :

| Mode | Réglage | Comportement |
|---|---|---|
| `platform` (défaut) | `APP_MODE=platform` | Place de marché multi-restaurants : comportement historique, écrans et règles inchangés. |
| `single` | `APP_MODE=single` + `TENANT_RESTAURANT_ID` | L'instance entière (frontend, API, base, dossier d'images) est liée à **un** restaurant, exploitée sous son nom, son logo et son domaine. |

Chaque restaurateur licencié reçoit **sa propre instance** (option B du cahier des charges) :
aucune donnée ne cohabite avec un autre restaurant, l'éditeur (PickEatGo) garde la propriété du
code et la main technique. Ce document décrit ce qui change en mode single ; les guides
[Créer une instance](12-creer-une-instance.md) (éditeur) et [Mon application](13-guide-mon-application.md)
(restaurateur) détaillent l'exploitation.

## Variables d'instance

| Variable | Service | Valeur | Effet |
|---|---|---|---|
| `APP_MODE` | API | `platform` (défaut) ou `single` | Active le mode mono-restaurant. Toute autre valeur bloque le démarrage (`tenant.E001`). |
| `TENANT_RESTAURANT_ID` | API | UUID du restaurant | Restaurant lié. Vérifié au démarrage : s'il n'existe pas, le service refuse de démarrer (`tenant.E002`) ; s'il est vide, avertissement `tenant.W001` et l'API répond « instance non configurée ». |
| `TENANT_TIMEZONE` | API | `Europe/Brussels` par défaut | Fuseau de référence de toutes les règles horaires (remplace la constante). Transmis au frontend par `/branding/`. |
| `POWERED_BY_BADGE` | API | `true` / `false` | Mention « Application propulsée par PickEatGo » dans le pied de page, les e-mails et les tickets (option de licence). |
| Variables existantes | API / frontend | | `SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, CORS, `FRONTEND_URL`, Cloudinary (`CLOUDINARY_FOLDER` dédié), SMTP, VAPID, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` : une valeur par instance. |

Les vérifications sont des « system checks » Django (`manage.py check`, `migrate`, `runserver`)
et sont rejouées au démarrage ASGI (`pickeatgo/asgi.py`).

## Règles du mode single

- **Restaurants** : toutes les requêtes publiques ne renvoient que le restaurant lié ; un autre
  identifiant répond 404, pour l'éditeur aussi. `POST /restaurants/` répond 403 ; `validate`,
  `suspend`, `contract` et la suppression sont désactivés. Le statut renvoyé est toujours « actif » :
  l'étape de validation n'existe pas, l'interrupteur et les horaires décident de l'ouverture.
- **Comptes** : l'inscription publique n'accepte que le rôle client (400 sinon). Le rôle
  administration reste disponible pour l'éditeur (supervision, support).
- **Données liées** : menus, commandes, promos, clôtures, employés, mouvements de stock,
  fournisseurs et ingrédients sont filtrés sur le restaurant lié (`apps/tenant/context.py` :
  `scope_restaurants`, `scope_by_restaurant`, `get_owned_restaurant`). La propriété du restaurant
  reste la source de vérité des permissions.
- **Commandes** : une commande sur un autre restaurant est refusée ; devis de livraison, codes
  promo et fidélité ne connaissent que le restaurant lié.
- **E-mails** : objet préfixé du nom de l'application, signature `— <nom>`, expéditeur
  `<nom> via PickEatGo <adresse de l'éditeur>` (ou `<nom> <adresse>` sans la mention) ; contexte
  `brand` dans `apps/tenant/brand.py`.
- **Notifications push** : titre et icône de la marque dans la charge utile ; le service worker
  les utilise.
- **Tâches planifiées** : `stock_digest` et `weekly_report` ne s'adressent qu'au restaurant lié,
  sous la marque.
- **Fuseau** : `TIME_ZONE = TENANT_TIMEZONE` côté serveur ; `lib/hours.js` reçoit le fuseau du
  contexte de marque côté navigateur.

## Marque de l'application

Modèle `Branding` (`apps/tenant/models.py`, table `branding`, une ligne par instance, liée au
restaurant), créé à la volée avec les valeurs par défaut (nom du restaurant, nom court tronqué à
12 caractères, TVA et adresse du restaurant). Champs : `app_name` (40), `short_name` (12),
`tagline` (120), `welcome_text` (300), `icon_192`, `icon_512`, `icon_maskable`, `share_image`,
`theme_color` (fixé à `#FF6B2C` dans cette version), `social_links` (JSON : facebook, instagram,
tiktok, website), `legal_name`, `company_number`, `vat_number`, `legal_address`, `publisher`,
`terms_text`, `privacy_text`, `sender_name`, `updated_at`.

Le restaurateur la modifie dans **Paramètres → Mon application** (identité avec aperçu en direct,
icônes, coordonnées et réseaux, textes légaux avec modèles, lien et QR code, état de publication).

## Points d'entrée API

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `/api/v1/branding/` | Public | `mode`, `timezone`, `powered_by_badge`, `configured`, `restaurant` (détail public avec horaires, galerie, catégories et plats : la carte est préchargée), `brand`, `publication` (état de mise en ligne). Cache serveur 60 s, `Cache-Control: public, max-age=60`, invalidé dès qu'un réglage change. |
| PATCH | `/api/v1/branding/` | Propriétaire ou éditeur | Modification des champs de marque ; validation des longueurs et des URL. 404 en mode plateforme. |
| POST | `/api/v1/branding/icons/` | Propriétaire ou éditeur | multipart `image` (`kind=icons`) : recadrage carré, icônes 192, 512 et maskable (80 % du canevas sur fond orange) ; `source=logo` : génération depuis le logo du restaurant ; `kind=share` : image de partage recadrée en 1200 × 630. |
| GET | `/api/v1/branding/instance/` | Éditeur (administration) | Fiche technique : licencié, domaine, version (commit Render), démarrage, services (base, Redis, Cloudinary, SMTP, VAPID), activité, journal technique récent. |
| GET | `/manifest.webmanifest` | Public (frontend) | Manifest généré depuis la marque (nom, nom court, icônes, raccourcis « Commander » et « Mes commandes »), revalidé toutes les 60 s. |

## Frontend

- `lib/brand.js` : lecture de `/branding/` (serveur : revalidation 60 s, repli PickEatGo ;
  navigateur : cache localStorage puis revalidation), métadonnées dérivées.
- `lib/BrandContext.js` : contexte `useBrand()` (`single`, `restaurant`, `brand`, `badge`,
  `timezone`, `publication`, `refresh`) ; fixe le fuseau de `lib/hours.js` et la marque des
  tickets (`lib/ticket.js`).
- `app/layout.jsx` : `generateMetadata` (titre, description, icônes, image de partage, nom
  d'installation) ; `app/manifest.js` : manifest dynamique.
- `app/page.jsx` + `app/single.jsx` : en mode single, l'accueil est la page du restaurant
  (bandeau, slogan, bouton Commander ou « Fermé · ouvre à … », photos du lieu, horaires, avis
  récents, pied de page) ; barre du haut « logo + nom, Carte, Mes commandes, panier, profil » ;
  écrans `/#menu`, `/#cart`, `/#confirm`, `/#history`, `/#profile`, `/#about`, `/#legal` ;
  recherche, filtres et favoris de restaurants retirés ; bannière « Ajouter à l'écran d'accueil »
  après la première commande.
- `app/login/page.jsx` : inscription limitée au rôle client, marque du restaurant.
- `app/dashboard/myapp.jsx` : carte « Mon application » ; `ProfileForm` : cuisine modifiable.
- `app/admin/page.jsx` + `app/admin/instance.jsx` : console éditeur (fiche d'instance, utilisateurs avec
  réinitialisation de mot de passe `POST /auth/users/{id}/reset-password/`,
  signalements, statistiques ; validation et contrats retirés).
- Identité visuelle : aucune feuille de style modifiée, variables de couleur PickEatGo conservées.

## Tests

La suite pytest s'exécute dans les deux modes (`PICKEATGO_TEST_MODE=single` lie l'instance au
restaurant de la fixture `restaurant`) ; `tests/test_single_mode.py` couvre `/branding/`, les icônes,
les règles du mode single, les e-mails et notifications sous la marque, `bootstrap_tenant`, les
vérifications de démarrage et la fiche d'instance. L'intégration continue lance les deux modes et
amorce une instance de test. Voir [09 · Tests et qualité](09-tests-qualite.md).
