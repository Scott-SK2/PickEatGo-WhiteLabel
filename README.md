# PickEatGo

Plateforme de précommande et de gestion pour restaurants : le client commande en ligne et
récupère sur place à l'heure choisie ; le restaurateur suit ses commandes en temps réel,
encaisse ses ventes au comptoir, gère ses stocks (alertes, pertes, inventaire), consulte
son journal des ventes (export CSV/Excel) et clôture sa journée.

L'application est installable sur téléphone et tablette (PWA : « Ajouter à l'écran d'accueil »).

**Édition Marque Blanche** : le même code, en mode `APP_MODE=single`, livre l'application à un seul
restaurant sous son nom, son logo, ses textes et son domaine (une instance par restaurant, données
isolées, supervision par PickEatGo). Voir `docs/11-marque-blanche.md`, `docs/12-creer-une-instance.md`
et `docs/13-guide-mon-application.md`.

## Structure

```
backend/    API Django REST + WebSocket (Django Channels)
  apps/accounts      utilisateurs et rôles (client, restaurateur, admin)
  apps/restaurants   restaurants, horaires, signalements
  apps/menus         catégories, plats, options, photos (Cloudinary)
  apps/orders        commandes, statuts, notifications temps réel
  apps/tenant        édition Marque Blanche : mode mono-restaurant, marque, /branding/, bootstrap_tenant
  tests/             suite pytest
  DEPLOY_RENDER.md   procédure de déploiement Render
frontend/   Application Next.js (App Router)
  app/               page client (/), login, dashboard restaurateur, admin
  lib/               client API, hooks, WebSocket, contexte d'authentification
docs/       documentation complète (voir docs/README.md)
tools/      données de démonstration (seed_demo.py), harnais d'audit responsive, création d'instance (create_instance.py)
```

## Lancer en local

Backend (Python 3.12) :

```
cd backend
cp .env.example .env          # puis remplir les valeurs
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver     # ou : uvicorn pickeatgo.asgi:application --reload
```

Sans `DATABASE_URL` le backend utilise SQLite ; sans `REDIS_URL` le temps réel
fonctionne en mémoire (un seul processus). `docker-compose.yml` démarre
PostgreSQL + Redis + backend en une commande.

Frontend (Node 20) :

```
cd frontend
npm install
npm run dev                    # http://localhost:3000
```

Variables frontend : `NEXT_PUBLIC_API_URL` (défaut `http://localhost:8000/api/v1`)
et `NEXT_PUBLIC_WS_URL` (défaut `ws://localhost:8000`).

## Tests et intégration continue

```
cd backend && pytest
```

Le workflow `.github/workflows/ci.yml` lance les tests backend (PostgreSQL + Redis) dans les
deux modes (`platform`, puis `PICKEATGO_TEST_MODE=single`), amorce une instance de test et
construit le frontend à chaque push et pull request sur `main`.

## Déploiement

- Backend : Render, configuration manuelle décrite dans `backend/DEPLOY_RENDER.md`.
- Frontend : Vercel, déploiement automatique depuis GitHub.
- Images : Cloudinary.

## Documentation

Le dossier `docs/` contient la documentation complète : présentation, installation et
déploiement, guides client / restaurateur / administration, architecture, référence API,
sécurité, tests et exploitation. Point d'entrée : `docs/README.md`.
