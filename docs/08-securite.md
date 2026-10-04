# 08 · Sécurité et données

## Authentification

- Jetons JWT (SimpleJWT) : jeton d'accès valable 30 minutes, jeton de rafraîchissement
  valable 7 jours. Chaque rafraîchissement renvoie un nouveau jeton de rafraîchissement et
  révoque l'ancien (liste noire). La déconnexion révoque le jeton de rafraîchissement.
- Le frontend renouvelle le jeton automatiquement sur 401 puis rejoue la requête ; deux
  onglets qui renouvellent en même temps ne se déconnectent pas l'un l'autre. Un échec réseau
  du renouvellement ne déconnecte pas ; seul un jeton réellement invalide renvoie à la
  connexion.
- Le WebSocket reçoit le jeton dans son premier message, jamais dans l'URL.
- Mots de passe : 8 caractères minimum, validateurs Django. Réinitialisation par lien à
  usage unique (générateur de jetons Django), 5 demandes par heure et par adresse IP, réponse
  identique que l'adresse existe ou non.

## Rôles et permissions

| Ressource | Public | Client | Restaurateur | Admin |
|---|---|---|---|---|
| Restaurants actifs, menus, avis | lecture | lecture | lecture | lecture |
| Restaurants en attente ou suspendus | non | non | le sien | tous |
| Contrat, facturation, e-mail du propriétaire | non | non | le sien | tous |
| Créer un restaurant | non | non | oui (un par compte) | oui |
| Catégories, plats, photos, stocks, ingrédients, équipe, promos | non | non | les siens | tous |
| Commandes | non | les siennes | celles de son restaurant | toutes |
| Modifier / supprimer une commande directement | non | non | non | non |
| Avancer / annuler une commande | non | annuler si « nouvelle » | oui | oui |
| Statut d'un restaurant, contrat, mise en avant | non | non | non | oui |
| Utilisateurs, signalements (statut) | non | non | non | oui |

Règles d'application côté serveur :

- Le rôle ne peut pas être choisi à l'inscription au-delà de client / restaurateur, ni
  modifié par l'utilisateur lui-même. Les comptes admin se créent par `createsuperuser` ou
  `create_admin`.
- La propriété est vérifiée sur chaque écriture (catégorie, plat, photo, employé, promo,
  ingrédient), y compris lors d'un déplacement vers un autre restaurant.
- Les champs privés du restaurant sont retirés de la réponse pour tout appelant qui n'est
  ni admin ni propriétaire.

## Données personnelles

- Le client choisit à l'inscription si son téléphone est visible du restaurateur ; sinon
  la liste de clientèle ne montre ni téléphone ni e-mail.
- Les avis sont publics avec le prénom et le nom du client.
- Les PIN des employés sont stockés hachés (même algorithme que les mots de passe).
- Les exports tableur neutralisent les cellules commençant par `=`, `+`, `-` ou `@`.
- Le jeton de réinitialisation est retiré de l'URL du navigateur après lecture.
- La déconnexion n'efface que la session ; les préférences de l'appareil (impression,
  panier) sont conservées.

## Protection contre les abus

- Limites de débit : 100 requêtes/heure pour les anonymes, 1000/heure pour les connectés,
  5/heure pour la réinitialisation de mot de passe, 30/minute pour le déverrouillage PIN.
- Double envoi : verrous de ligne sur l'avancement et l'annulation, incrément atomique des
  codes promo, recomptage de la capacité des créneaux sous verrou, stock jamais négatif.
- Uploads : type MIME limité à JPEG, PNG, WebP et 5 Mo. Le contenu n'est pas inspecté au-delà
  du type déclaré (les images passent par Cloudinary en production).
- Retrait dans le passé refusé (tolérance 30 minutes) ; commande hors horaires refusée.

## Configuration de production

- `SECRET_KEY` obligatoire (le service refuse de démarrer sans valeur propre), `DEBUG`
  forcé à faux, HSTS un an avec sous-domaines, `nosniff`, cookies sécurisés, en-tête
  `X-Forwarded-Proto` honoré derrière le proxy Render.
- CORS limité aux origines listées dans `CORS_ALLOWED_ORIGINS`.
- Les secrets ne sont jamais dans le dépôt : `backend/.env` est ignoré par git. Si un secret
  a été exposé (par exemple dans l'historique), le faire tourner chez le fournisseur
  (Cloudinary, SMTP) et mettre à jour les variables Render.

## Points d'attention connus

- Le jeton `?token=` dans l'URL du WebSocket reste accepté pour les anciennes versions
  installées ; le retirer lorsqu'elles auront disparu (`pickeatgo/middleware.py`).
- Les liens de réinitialisation et les e-mails dépendent de `FRONTEND_URL`.
- Sans Redis, le temps réel ne fonctionne qu'avec un seul processus.
