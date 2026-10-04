# 01 · Présentation

## Le produit en une page

PickEatGo remplace la file d'attente et le téléphone : le client choisit ses plats sur le
site (ou l'application installée sur son téléphone), indique comment et quand il veut être
servi, paie à la remise, et suit l'avancement de sa commande en direct. Le restaurateur
reçoit la commande sur sa tablette, la fait avancer étape par étape, encaisse aussi les
clients de passage, et dispose de tout ce qu'il faut pour gérer l'établissement : menu avec
photos, stocks et ingrédients, journal des ventes, clôture de journée, fidélité, codes promo,
équipe avec codes PIN, impression de tickets.

Le paiement en ligne n'est pas encore proposé : l'encaissement se fait à la remise ou à la
livraison (espèces ou carte), et il est enregistré dans le journal des ventes.

## Les trois rôles

| Rôle | Où | Ce qu'il fait |
|---|---|---|
| **Client** | Site public `/` | Cherche un restaurant, commande, suit, note, gère ses favoris et sa fidélité |
| **Restaurateur** | Tableau de bord `/dashboard` | Gère un restaurant (un compte = un restaurant), ses commandes, sa caisse, son menu, ses stocks, ses ventes, son équipe |
| **Administration** | Console `/admin` | Valide ou suspend les restaurants, gère les utilisateurs, les signalements, les contrats et la facturation |

Un compte restaurateur qui ouvre le site public est renvoyé vers son tableau de bord ; un
lien « Voir le site client » lui permet de consulter le site tel que ses clients le voient.

## Parcours type

1. Le restaurateur crée son compte et son restaurant depuis la page de connexion. Le
   restaurant est **en attente** : invisible du public.
2. L'administration valide le restaurant. Il devient **actif**.
3. Le restaurateur configure ses horaires, son menu, ses photos, ses modes de commande,
   puis met l'interrupteur sur « ouvert ».
4. Le client commande. Le restaurateur voit la commande arriver en direct, la confirme,
   la met en cuisine, la marque prête, l'encaisse à la remise (ou la passe « en livraison »).
5. Le client reçoit les changements d'état en direct, puis note sa commande. Le
   restaurateur peut répondre publiquement à l'avis.

## Pile technique

| Couche | Technologie | Rôle |
|---|---|---|
| API | Django 5, Django REST Framework, SimpleJWT | Données, règles métier, authentification |
| Temps réel | Django Channels, Redis (Key Value Render) | Nouvelles commandes et changements d'état poussés au navigateur |
| Base de données | PostgreSQL (SQLite en local) | Toutes les données |
| Images | Cloudinary | Logos, bannières, photos des plats et du lieu |
| E-mails | SMTP (variables `EMAIL_*`) | Confirmation, commande prête, mot de passe oublié, récapitulatifs |
| Notifications push | Web Push (VAPID) | Alerte sur l'appareil même application fermée |
| Frontend | Next.js 16 (App Router), React 19 | Site client, tableau de bord, console admin, PWA |
| Hébergement | Render (API, Postgres, Key Value, crons) et Vercel (frontend) | Production |

## Hébergement en production

- Frontend : `https://pick-eat-go.vercel.app`, déployé par Vercel à chaque fusion sur
  `main`.
- API : service web Render (dossier `backend`), déployé de la même façon, avec migrations
  et création du compte admin au démarrage.
- Les URL de l'API et du WebSocket sont données au frontend par `NEXT_PUBLIC_API_URL` et
  `NEXT_PUBLIC_WS_URL`.

## Organisation du dépôt

```
backend/            API Django (voir 06 · Architecture)
frontend/           Application Next.js
docs/               cette documentation
tools/              données de démonstration et harnais d'audit responsive
.github/workflows/  intégration continue
```
