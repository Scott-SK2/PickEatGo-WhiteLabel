# Modes de commande et livraison

## En quoi ça consiste

Un **mode de commande** est la façon dont le client récupère son repas. PickEatGo en
propose trois au client, plus un réservé au restaurateur :

| Mode | Code | Ce que ça signifie | Qui peut le choisir |
|---|---|---|---|
| 🪑 Sur place | `sur_place` | Le client mange au restaurant, à l'heure choisie. | Client |
| 🥡 À emporter | `emporter` | Le client passe chercher sa commande à l'heure choisie. | Client |
| 🛵 Livraison | `livraison` | Le restaurant apporte la commande à l'adresse indiquée, à l'heure souhaitée. | Client |
| 🧾 Comptoir | `comptoir` | Vente encaissée directement en caisse, sans passer par l'application. | Restaurateur et employés uniquement |

Le restaurateur **active ou désactive** chaque mode client. Un restaurant peut donc être
« à emporter uniquement », « sur place et livraison », etc. Au moins un mode doit rester
actif. Par défaut, sur place et à emporter sont actifs, la livraison ne l'est pas.

La **livraison** est le mode le plus riche : elle demande une adresse, ne fonctionne qu'à
certains jours et heures, peut avoir des frais, un montant minimum et une zone desservie.
Chaque restaurant règle tout cela lui-même dans Paramètres.

## Côté restaurateur : Paramètres → « Modes de commande »

### Activer ou désactiver un mode

Trois cases : « Sur place », « À emporter », « Livraison ». Décocher retire le mode du
panier client. L'API refuse toute commande dans un mode désactivé, même si un client
tentait de forcer l'envoi.

### Frais de livraison

Deux modèles, au choix :

- **Frais fixes** : un montant unique quel que soit le lieu de livraison (0 € possible).
- **Par zone (code postal)** : une liste de zones, chacune avec un nom (« Centre »), des
  codes postaux et un tarif. Le client indique son code postal ; s'il n'est dans aucune
  zone, la livraison est refusée avant même de commander, avec le message « Nous ne
  livrons pas encore le code postal … ».

Dans les deux modèles :

- **Offerts à partir de (€)** : si le sous-total des articles atteint ce montant, les frais
  passent à 0 €. Laisser vide (« jamais ») pour ne jamais les offrir.
- **Commande minimum (€)** : en dessous de ce sous-total, la livraison est impossible.
  0 pour aucun minimum.

Le sous-total pris en compte est le montant des articles après remise (code promo ou
récompense fidélité), hors frais de livraison.

### Créneaux de livraison

- **Jours** : les jours où l'on livre. Aucun jour coché signifie tous les jours.
- **De / à** : plage horaire de livraison. Vide de chaque côté signifie aux heures
  d'ouverture.
- Une heure demandée hors de ces créneaux est refusée avec le message « La livraison n'est
  possible que : … ».

### Informations pour le client

Texte libre affiché dans le panier en mode livraison, par exemple « Bruxelles centre
uniquement, délai 30 à 45 min ».

## Côté client

1. Dans le panier, le client choisit parmi les modes actifs. Les modes désactivés ne sont
   pas proposés.
2. En **livraison**, deux champs obligatoires apparaissent : « Adresse de livraison
   complète » et « Code postal ». L'heure devient « Heure de livraison souhaitée » et seuls
   les créneaux compatibles avec les jours et heures de livraison sont proposés. Si aucun
   créneau ne convient aujourd'hui, le message « Pas de livraison possible aujourd'hui »
   s'affiche.
3. Dès que le code postal est saisi, le panier interroge l'API et affiche la ligne
   « Frais de livraison » (ou « offerts »), le montant minimum s'il n'est pas atteint, ou
   le motif de refus.
4. Le total affiché est : articles, moins remise, plus frais de livraison.
5. Après la commande, le suivi affiche cinq étapes pour une livraison (au lieu de quatre) :
   Nouvelle → Confirmée → En cuisine → Prête → **En livraison** → Livrée, avec le message
   « Votre commande est en route vers vous ! » au moment du départ.

## Cycle de vie d'une commande

| Statut | Code | Sur place / à emporter | Livraison |
|---|---|---|---|
| Nouvelle | `nouvelle` | Reçue, en attente du restaurateur | idem |
| Confirmée | `confirmee` | Acceptée | idem |
| En cuisine | `en_cuisine` | En préparation | idem |
| Prête | `prete` | Le client peut venir. Encaissement à cette étape. | Le livreur va partir |
| En livraison | `en_livraison` | n'existe pas | En route. Encaissement à cette étape (paiement à la livraison). |
| Récupérée / Livrée | `recuperee` | Remise au client | Affichée « Livrée » |
| Annulée | `annulee` | | |

Le bouton d'avancement du tableau de bord suit cet enchaînement automatiquement : sur une
commande en livraison au statut « Prête », il affiche « Partie en livraison » au lieu de
« Récupérée ».

Le client peut annuler tant que la commande n'est pas prête ; à partir de « Prête » ou
« En livraison », l'annulation est refusée.

## Tableau de bord et tickets

- Les cartes de commande affichent 🛵 suivi de l'adresse de livraison et des frais.
- Le ticket cuisine porte la mention « LIVRER À : adresse ». Le ticket client indique la
  ligne « Frais de livraison » et l'adresse.
- Le journal des ventes et les rapports comptabilisent les frais de livraison dans le total
  de la commande.

## Comment sont calculés les frais

Fonction `Restaurant.delivery_quote(postcode, subtotal)` dans
`backend/apps/restaurants/models.py` :

1. Mode **fixe** : frais = `delivery_fee`.
2. Mode **zones** : le code postal est normalisé (espaces retirés, majuscules) puis cherché
   dans `delivery_zones`. Absent → refus. Trouvé → frais = tarif de la zone.
3. Si `delivery_free_above` est défini et que le sous-total l'atteint, frais = 0.
4. Le minimum de commande (`delivery_min_order`) est contrôlé séparément, à la création de
   la commande et dans l'estimation.

## API

### Champs du restaurant

Modifiables par le propriétaire via `PATCH /api/v1/restaurants/{id}/` :

| Champ | Type | Rôle |
|---|---|---|
| `allow_on_site`, `allow_pickup`, `allow_delivery` | booléens | Modes actifs. Tout désactiver est refusé : « Gardez au moins un mode de commande actif. » |
| `delivery_fee_mode` | `"fixed"` ou `"zones"` | Modèle de frais. |
| `delivery_fee` | décimal | Frais en mode fixe. |
| `delivery_zones` | liste | `[{"label": "Centre", "postcodes": ["1000", "1050"], "fee": "2.50"}]`. Chaque zone doit avoir au moins un code postal et des frais non négatifs ; les codes sont normalisés (sans espaces, majuscules). |
| `delivery_free_above` | décimal ou `null` | Seuil de gratuité. |
| `delivery_min_order` | décimal | Commande minimum. |
| `delivery_days` | liste d'entiers 0 à 6 | Jours de livraison (0 = lundi). Vide = tous. |
| `delivery_from`, `delivery_until` | heures `HH:MM` ou `null` | Plage de livraison. |
| `delivery_info` | texte (200) | Message affiché au client. |

En lecture, `delivery_schedule_label` donne un résumé lisible des créneaux
(« Lun–Ven · 18:00–22:00 »).

### Estimation des frais avant commande

```
POST /api/v1/orders/delivery/quote/       (accès public)
{"restaurant": 12, "postcode": "1050", "subtotal": "24.50"}
```

Réponse :

```
{"fee": "2.50", "free": false, "min_order": "15.00", "below_min": false, "free_above": "30.00"}
```

Erreurs `400` : « Ce restaurant ne livre pas. », « Indiquez votre code postal. »,
« Nous ne livrons pas encore le code postal 1200. », « Requête invalide. ».

### Création d'une commande

`POST /api/v1/orders/` avec `order_type` parmi `sur_place`, `emporter`, `livraison`.
En livraison, `delivery_address` et `delivery_postcode` sont requis.

Contrôles, dans l'ordre :

| Message | Cause |
|---|---|
| `Livraison n'est pas proposé par ce restaurant.` | Mode désactivé (le libellé varie selon le mode). |
| `Indiquez l'adresse de livraison.` | Adresse vide. |
| `La livraison n'est possible que : Lun–Ven · 18:00–22:00.` | Jour ou heure hors créneau. |
| `Livraison à partir de 15.00 € de commande.` | Sous-total sous le minimum. |
| `Nous ne livrons pas encore le code postal …` | Code postal hors zones. |
| `Type réservé aux ventes au comptoir.` | Un client a envoyé `comptoir`. |

La commande créée porte `delivery_fee` (frais calculés) et `total_price` (articles moins
remise plus frais). Le champ `subtotal` en lecture donne le montant des articles après
remise, hors frais.

### Avancement du statut

`PATCH /api/v1/orders/{id}/advance/` fait passer la commande à l'étape suivante. Pour une
livraison, « Prête » mène à « En livraison » puis à « Récupérée ». La logique est dans
`Order.next_status` (`backend/apps/orders/models.py`).

## Tests

`backend/tests/test_delivery.py` couvre : refus d'un mode désactivé, impossibilité de tout
désactiver, règles de livraison (adresse, créneaux, minimum), passage par « En livraison »,
frais par zone et gratuité au-dessus du seuil.

```
cd backend && pytest tests/test_delivery.py
```
