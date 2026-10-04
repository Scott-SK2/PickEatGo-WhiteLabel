# Déploiement Render (configuration manuelle)

Le backend est géré manuellement depuis le dashboard Render (plus de Blueprint).
Le frontend est déployé automatiquement par Vercel depuis GitHub.

Les trois ressources doivent être dans la **même région** (URLs internes).

## 1. Postgres

- New → Postgres
- Name : `pickeatgo-db`
- Region : Frankfurt (EU Central)
- Plan : payant (Basic 256 MB ou plus). Ne jamais utiliser le plan Free : il expire après
  30 jours et la base est supprimée avec ses données.
- Récupérer l'**Internal Database URL**

## 2. Key Value (Redis / Valkey)

- New → Key Value
- Name : `pickeatgo-redis`
- Region : Frankfurt (EU Central)
- Maxmemory policy : `allkeys-lru`
- Récupérer l'**Internal Key Value URL** (`redis://red-...:6379`)

## 3. Web Service (backend Django)

- New → Web Service → repo `Scott-SK2/PickEatGo`, branche `main`
- Name : `pickeatgo-backend` (détermine l'URL `https://pickeatgo-backend.onrender.com`)
- Region : Frankfurt (EU Central)
- Runtime : Python 3
- Root Directory : `backend`
- Plan : Starter

Build Command :
```
pip install -r requirements.txt && DATABASE_URL=sqlite:///tmp/build-dummy.db python manage.py collectstatic --noinput
```

Start Command :
```
python manage.py migrate --noinput && python manage.py create_admin && uvicorn pickeatgo.asgi:application --host 0.0.0.0 --port $PORT --workers 1 --log-level info --lifespan off
```

Health Check Path : `/admin/login/`
Auto-Deploy : Yes

### Variables d'environnement

| Clé | Valeur |
|---|---|
| `PYTHON_VERSION` | `3.12.7` |
| `DJANGO_SETTINGS_MODULE` | `pickeatgo.settings` |
| `ENV` | `production` |
| `DEBUG` | `False` |
| `SECRET_KEY` | chaîne aléatoire longue (bouton Generate) |
| `DATABASE_URL` | Internal Database URL de l'étape 1 |
| `REDIS_URL` | Internal Key Value URL de l'étape 2 |
| `CORS_ALLOWED_ORIGINS` | `https://pick-eat-go.vercel.app` |
| `CLOUDINARY_CLOUD_NAME` | depuis le dashboard Cloudinary |
| `CLOUDINARY_API_KEY` | depuis le dashboard Cloudinary |

Instance Marque Blanche (un seul restaurant) : ajouter `APP_MODE=single`, `TENANT_TIMEZONE`,
`POWERED_BY_BADGE`, `FRONTEND_URL`, un `CLOUDINARY_FOLDER` dédié, puis `TENANT_RESTAURANT_ID` une fois
`python manage.py bootstrap_tenant` exécuté dans le shell du service (voir `docs/12-creer-une-instance.md`).
| `CLOUDINARY_API_SECRET` | depuis le dashboard Cloudinary |
| `CLOUDINARY_FOLDER` | dossier racine Cloudinary (optionnel, défaut `pickeatgo`) |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | SMTP pour les e-mails (optionnel ; sans `EMAIL_HOST`, les e-mails sont affichés dans les logs) |
| `DEFAULT_FROM_EMAIL` | expéditeur, ex. `PickEatGo <no-reply@votredomaine.be>` |
| `FRONTEND_URL` | `https://pick-eat-go.vercel.app` — utilisé dans les liens des e-mails (mot de passe oublié) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_ADMIN_EMAIL` | notifications push (optionnel). Générer une fois avec `python manage.py generate_vapid_keys` (onglet Shell) et coller les deux clés ; sans elles, le push est simplement désactivé |

## 3 bis. Cron Job : récapitulatif des stocks (optionnel)

Pour que chaque restaurateur reçoive le matin la liste de ses plats épuisés ou bientôt
épuisés : New → **Cron Job**, même repo, Root Directory `backend`, mêmes variables
d'environnement que le backend, commande :
```
pip install -r requirements.txt && python manage.py stock_digest
```
Planification `0 7 * * *` (7 h chaque jour). Nécessite la configuration SMTP ci-dessus.

Même principe pour le **bilan hebdomadaire** (CA, ventes, panier moyen comparés à la
semaine précédente, top produits, alertes, avis sans réponse) : un second Cron Job avec
`pip install -r requirements.txt && python manage.py weekly_report`, planification `0 8 * * 1` (lundi 8 h).

## 4. Premier lancement

Deux façons de créer le compte administrateur (rôle admin attribué automatiquement) :

**A. Avec l'onglet Shell du service** (instances payantes) :
```
python manage.py createsuperuser
```

**B. Sans shell** : ajouter les variables d'environnement `ADMIN_EMAIL` et `ADMIN_PASSWORD`
(8 caractères minimum), redéployer. La commande `create_admin` du Start Command crée le compte
au démarrage s'il n'existe pas (ou promeut admin un compte existant avec cet e-mail).
Retirer ensuite `ADMIN_PASSWORD` des variables. Connexion sur `<frontend>/login`, redirection vers `/admin`.

**Accès admin perdu ?** Ajouter `ADMIN_EMAIL`, `ADMIN_PASSWORD` et `ADMIN_RESET_PASSWORD=1`,
redéployer : le mot de passe du compte est remplacé (et le compte promu admin s'il ne l'était pas).
Retirer les trois variables ensuite.

## 5. Frontend (Vercel)

Si l'URL du backend change, mettre à jour dans Vercel → Settings → Environment Variables,
puis redéployer :

| Clé | Valeur |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<backend>.onrender.com/api/v1` |
| `NEXT_PUBLIC_WS_URL` | `wss://<backend>.onrender.com` |
