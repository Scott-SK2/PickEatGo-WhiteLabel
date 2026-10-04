# 02 · Installation et déploiement

## Lancer en local

### Backend (Python 3.12)

```
cd backend
cp .env.example .env            # puis remplir les valeurs utiles
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
uvicorn pickeatgo.asgi:application --reload --port 8000
```

`uvicorn` est nécessaire pour le WebSocket ; `python manage.py runserver` fonctionne pour
l'API seule. Sans `DATABASE_URL`, la base est un fichier SQLite ; sans `REDIS_URL`, le
temps réel utilise une couche en mémoire (un seul processus, suffisant en local).

Données de démonstration (restaurant Burger House, comptes de test, commandes, stocks) :

```
cd backend && python manage.py shell < ../tools/seed_demo.py
```

Comptes créés, mot de passe `Demo1234!` : `marie@example.com` (restauratrice),
`jean@example.com` (client), `admin@example.com` (administration). Employés de Burger
House : Sarah, caissière, PIN 4826 ; Marco, gérant, PIN 7391.

### Frontend (Node 20 ou plus)

```
cd frontend
npm install
npm run dev                     # http://localhost:3000
```

Variables : `NEXT_PUBLIC_API_URL` (défaut `http://localhost:8000/api/v1`) et
`NEXT_PUBLIC_WS_URL` (défaut `ws://localhost:8000`). Pour tester comme en production,
`npm run build && npm run start`.

### Docker

`docker-compose.yml` démarre PostgreSQL, Redis et le backend en une commande.

## Variables d'environnement du backend

| Variable | Obligatoire | Rôle |
|---|---|---|
| `SECRET_KEY` | Oui en production | Signature des jetons. Le service refuse de démarrer en production sans valeur propre. |
| `DEBUG` | | `False` par défaut. En local, `True` sert aussi les images stockées localement. |
| `ENV` | | `production` sur Render. |
| `ALLOWED_HOSTS` | | Hôtes autorisés, séparés par des virgules. Render ajoute son propre domaine. |
| `DATABASE_URL` | Oui en production | URL PostgreSQL (Internal Database URL Render). |
| `REDIS_URL` | Recommandé | URL Key Value pour le temps réel multi-processus et le cache. |
| `CORS_ALLOWED_ORIGINS` | Oui | Origine du frontend, par exemple `https://pick-eat-go.vercel.app`. |
| `FRONTEND_URL` | | Base des liens dans les e-mails (mot de passe oublié). Par défaut la première origine CORS. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` | Recommandé | Stockage des images. Sans cloud name, les fichiers sont écrits localement. |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL` | Recommandé | Envoi des e-mails. Sans `EMAIL_HOST`, les e-mails sont écrits dans les journaux. |
| `EMAIL_SYNC` | | `True` envoie les e-mails dans la requête au lieu d'un fil séparé (tests). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_ADMIN_EMAIL` | Optionnel | Notifications push. Sans clés, le push est simplement désactivé. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_RESET_PASSWORD`, `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` | Optionnel | Création ou réinitialisation du compte admin au démarrage (voir plus bas). |
| `APP_MODE` | | `platform` (défaut) ou `single` : édition Marque Blanche, instance dédiée à un restaurant (voir [11 · Marque Blanche](11-marque-blanche.md)). |
| `TENANT_RESTAURANT_ID` | Oui en mode single | UUID du restaurant lié, affiché par `python manage.py bootstrap_tenant`. Vérifié au démarrage. |
| `TENANT_TIMEZONE` | | Fuseau de référence des horaires et rapports (`Europe/Brussels` par défaut). |
| `POWERED_BY_BADGE` | | `true` / `false` : mention « propulsé par PickEatGo » (mode single). |

Le fichier `backend/.env` n'est jamais versionné ; `backend/.env.example` liste les clés.

## Déploiement sur Render

La procédure détaillée, écran par écran, est dans `backend/DEPLOY_RENDER.md`. En résumé :

1. **Postgres** payant (le plan gratuit expire au bout de 30 jours et supprime les
   données), région Frankfurt.
2. **Key Value** (Redis) dans la même région, politique `allkeys-lru`.
3. **Web Service** Python, dossier racine `backend`, branche `main`.
   - Build : `pip install -r requirements.txt && DATABASE_URL=sqlite:///tmp/build-dummy.db python manage.py collectstatic --noinput`
   - Démarrage : `python manage.py migrate --noinput && python manage.py create_admin && uvicorn pickeatgo.asgi:application --host 0.0.0.0 --port $PORT --workers 1 --log-level info --lifespan off`
   - Health check : `/api/v1/health/`
4. **Cron jobs** (optionnels, mêmes variables d'environnement) :
   - `python manage.py stock_digest` à `0 7 * * *` : e-mail matinal des stocks bas et épuisés.
   - `python manage.py weekly_report` à `0 8 * * 1` : bilan hebdomadaire du lundi.

Instance Marque Blanche (un restaurant) : même procédure avec les variables `APP_MODE=single`,
`TENANT_RESTAURANT_ID`, `TENANT_TIMEZONE`, `POWERED_BY_BADGE` et l'amorçage par `bootstrap_tenant` ;
guide complet dans [12 · Créer une instance](12-creer-une-instance.md).

Le service web sur l'offre gratuite s'endort après 15 minutes sans trafic et met 30 à
60 secondes à repartir. L'application le réveille dès la page de connexion et le maintient
éveillé tant qu'un tableau de bord est ouvert, mais le plan payant supprime ce délai.

## Déploiement sur Vercel

Projet lié au dépôt GitHub, dossier racine `frontend`. Variables :

| Clé | Valeur |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<service>.onrender.com/api/v1` |
| `NEXT_PUBLIC_WS_URL` | `wss://<service>.onrender.com` |

Vercel publie la branche `main`. Les autres branches produisent des aperçus.

## Compte administrateur

Deux méthodes :

- **Shell Render** (instances payantes) : `python manage.py createsuperuser`. Le rôle admin
  est attribué automatiquement.
- **Variables d'environnement** : définir `ADMIN_EMAIL` et `ADMIN_PASSWORD` (8 caractères
  minimum) puis redéployer. La commande `create_admin` du démarrage crée le compte s'il
  n'existe pas, ou promeut admin un compte existant portant cet e-mail. Retirer ensuite
  `ADMIN_PASSWORD`.

Accès perdu : ajouter `ADMIN_RESET_PASSWORD=1` avec les deux variables ci-dessus et
redéployer ; le mot de passe est remplacé. Retirer les trois variables ensuite.

Ne pas utiliser l'e-mail d'un compte restaurateur comme `ADMIN_EMAIL` : le compte serait
promu admin et perdrait l'accès à son tableau de bord.

## Notifications push (quand vous le déciderez)

1. Dans le shell du service : `python manage.py generate_vapid_keys`.
2. Coller `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` dans les variables du service, avec
   `VAPID_ADMIN_EMAIL` (une adresse de contact).
3. Redéployer. Le bouton d'activation apparaît dans le profil client et dans les
   paramètres du restaurateur.
