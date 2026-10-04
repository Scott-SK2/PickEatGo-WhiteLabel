# 03 · Guide client

Le site public est accessible à l'adresse du frontend (`/`). Il fonctionne sur téléphone,
tablette et ordinateur, et peut être installé sur l'écran d'accueil (« Ajouter à l'écran
d'accueil » dans le menu du navigateur).

## Compte

- **Créer un compte** depuis « Se connecter » → « Créer un compte » : prénom, nom, e-mail,
  téléphone (obligatoire), mot de passe. Le téléphone peut être **masqué** : le restaurateur
  ne le verra pas dans sa liste de clients.
- **Mot de passe oublié** : lien sur la page de connexion, un e-mail contient un lien valable
  une seule fois vers `/reset`.
- **Profil** (avatar en haut à droite) : prénom, nom, téléphone, changement de mot de passe,
  historique des commandes, activation des notifications, déconnexion.
- La session reste ouverte tant que l'application est utilisée, et 7 jours sans utilisation.

Consulter les restaurants et remplir un panier ne demande pas de compte ; la commande, oui.

## Trouver un restaurant

- **Accueil** : « Populaires maintenant » (restaurants ouverts) et « Tous les restaurants ».
  Les filtres par cuisine et « ❤️ Favoris » sont au-dessus de la liste. Un restaurant fermé
  apparaît grisé avec le badge « Fermé ».
- **Recherche** (loupe) : par nom ou par cuisine.
- **Page publique** (bouton ⓘ) : bannière, photos du lieu, description, adresse, horaires
  de la semaine, avis clients et réponses du restaurateur, bouton « Commander ici ».
- **Favoris** : le cœur sur une carte de restaurant. Les favoris sont conservés sur le compte.

Un restaurant est « ouvert » si le restaurateur l'a mis en service **et** que l'heure
actuelle est dans ses horaires du jour. L'heure de référence est celle de Bruxelles.

## Composer sa commande

- La carte est organisée par catégories. Un plat indique son prix, sa description, ses
  **allergènes** (⚠️), et selon le cas « Plus que N » (stock limité), « Épuisé », ou « Pas
  aujourd'hui » avec les jours et heures où il est proposé.
- Toucher un plat ouvre sa fiche : photos (faites défiler, touchez pour agrandir), options
  avec supplément éventuel, quantité, « Ajouter au panier ».
- Le bouton « Galerie » de la page du restaurant regroupe les photos du lieu et des plats.
- Le panier ne contient qu'un seul restaurant à la fois : ouvrir un autre restaurant avec un
  panier non vide le vide, avec un message.
- Le panier, le mode choisi, l'adresse de livraison et la note sont conservés si l'on quitte
  ou recharge la page.

## Panier et validation

1. **Comment souhaitez-vous être servi ?** Sur place, à emporter ou livraison, selon ce que
   propose le restaurant. En livraison : adresse complète et code postal obligatoires ; les
   frais, le minimum de commande et les créneaux de livraison s'affichent aussitôt.
2. **Heure de retrait** (ou de livraison souhaitée) : liste des créneaux possibles, à partir
   du temps de préparation moyen, jusqu'à la fermeture. Un plat à horaire limité impose son
   propre créneau.
3. **Note pour le restaurant** : allergie, préférence.
4. **Code promo** : saisir puis « Appliquer ». La remise est recalculée si le panier change.
5. **Carte de fidélité** : la progression s'affiche ; quand la récompense est prête, elle
   s'applique automatiquement si aucun code promo n'est saisi.
6. Récapitulatif : sous-total, remise, frais de livraison, total. Le bouton « Commander pour
   HH:MM » envoie la commande. Il reste inactif tant qu'un élément manque, et le motif est
   écrit dessus (« Adresse et code postal requis », « Aucun horaire disponible »…).

Le paiement se fait à la remise ou à la livraison, en espèces ou par carte.

## Suivre la commande

L'écran de suivi affiche le numéro de commande et les étapes : Nouvelle → Confirmée →
En cuisine → Prête → Récupérée (et « En livraison » avant « Livrée » pour une livraison).
Il se met à jour en direct. Tant que la commande est « Nouvelle », un bouton permet de
l'**annuler**. Quand elle est prête, le message « Votre commande est prête ! » s'affiche ;
si les notifications sont activées, l'appareil reçoit aussi une alerte, application fermée.

Le suivi reste disponible après un rechargement et depuis la pastille « #numéro » de la
barre du haut.

## Après la commande

- **Noter** : de 1 à 5 étoiles avec un commentaire facultatif, une seule fois par commande.
  La note alimente la moyenne du restaurant ; le restaurateur peut répondre publiquement.
- **Mes commandes** (profil) : historique avec détail des articles ; « Commander à nouveau »
  recompose le panier avec ce qui est encore disponible et signale les plats manquants.

## Notifications sur l'appareil

Dans le profil, l'interrupteur « Notifications sur cet appareil » demande l'autorisation du
navigateur. Elles préviennent quand la commande est prête. Sur iPhone, il faut d'abord
installer le site sur l'écran d'accueil. Si le serveur n'a pas encore de clés push, le
réglage l'indique.

## Questions fréquentes

- **Je ne vois pas de restaurant sur l'accueil.** Aucun restaurant validé n'est ouvert
  actuellement ; la liste « Tous les restaurants » montre aussi les restaurants fermés.
- **« Cet horaire est déjà passé. »** Le créneau choisi est dépassé, la liste a été rechargée ;
  choisissez-en un autre.
- **« Stock insuffisant pour … »** Le plat est parti entre la composition du panier et la
  validation ; réduisez la quantité.
- **Le bouton du panier a disparu après une mise à jour.** Rechargez la page une fois : les
  anciennes versions installées se mettent à jour à la réouverture.
