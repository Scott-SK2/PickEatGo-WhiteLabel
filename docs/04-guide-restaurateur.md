# 04 · Guide restaurateur

Le tableau de bord est accessible à `/dashboard` après connexion avec un compte
restaurateur. Sur ordinateur, la navigation est dans la colonne de gauche ; sur tablette et
téléphone, dans la barre du bas. L'application peut être installée sur la tablette du
comptoir (« Ajouter à l'écran d'accueil »).

## Démarrer

1. **Créer le compte et le restaurant** : page de connexion → « Créer un compte » →
   « Restaurateur », puis nom du restaurant, cuisines, adresse, téléphone, icône.
2. Le restaurant est **en attente de validation** par l'administration ; le tableau de
   bord est utilisable, mais le restaurant n'apparaît pas encore sur le site public.
3. Préparer l'établissement : Paramètres → horaires, logo, photos, modes de commande ;
   Menu → catégories, plats, photos ; Stocks si vous suivez les quantités.
4. Une fois validé, mettre l'interrupteur du bandeau sur **Ouvert**.

## Le bandeau du haut

- **État** : « Ouvert · ferme à 22:00 » (vert), « Fermé · ouvre à 11:30 » ou « Fermé ·
  horaires terminés » (ambre : interrupteur ouvert mais hors horaires), « Fermé » (rouge :
  interrupteur fermé). Un clic bascule l'interrupteur. Les clients ne peuvent commander que
  si l'état est vert.
- **Pastille « N nouvelles commandes »** : mène à l'onglet Commandes.
- **Actualiser**, **cloche** (nouvelles commandes, alertes de stock, ingrédients à
  commander), **point vert « En direct »** (connexion temps réel active).
- **Mode caissier** : voir plus bas.

## Vue d'ensemble

Indicateurs du jour (ventes, revenu, commandes à traiter, alertes de stock), alertes
détaillées avec lien « Gérer », commandes actives avec bouton d'avancement rapide,
activité de la semaine (commandes ou revenus), et « Vente comptoir ».

## Commandes

Filtres : Actives, Nouvelles, Confirmées, En cuisine, Prêtes, En livraison, Terminées.
Chaque carte montre le numéro, l'état, le mode (sur place, emporter, livraison, comptoir),
le client, l'heure de retrait, les articles avec options, la note, l'adresse de livraison et
les frais le cas échéant.

Avancement d'une commande : **Confirmer → En cuisine → Prête → Récupérée**. Pour une
livraison : **Prête → Partie en livraison → Livrée**. À l'étape d'encaissement (Prête pour
un retrait, En livraison pour une livraison), le bouton demande le mode de paiement :
espèces, carte, ou « ne pas préciser ». Le paiement est enregistré dans le journal des ventes.

**Annuler** est possible jusqu'à « En cuisine » inclus ; le stock réservé et le code promo
sont restitués, le client est prévenu. Le client, lui, ne peut annuler que tant que la
commande est « Nouvelle ».

**Tickets** : « Cuisine » (articles, options, note, « LIVRER À ») et « Ticket client »
(prix, remise, frais, mode de paiement, numéro de TVA et mention de pied de ticket). Format
80 mm, imprimante thermique ou papier. Dans Paramètres → Impression, l'impression peut être
automatique à la réception d'une commande et à la vente comptoir.

**Vente comptoir** : pour un client de passage. Choisir les articles, le mode de paiement,
éventuellement un code promo et une note, puis « Encaisser ». La vente est enregistrée au
statut « Récupérée » avec le type « Comptoir », décrémente le stock, et apparaît dans le
journal des ventes. En mode caissier, l'employé identifié est enregistré sur la vente.

## Menu

- **Catégories** : créées à la volée depuis le formulaire d'un plat (« Nouvelle
  catégorie »). Quatre catégories sont proposées à la création du restaurant.
- **Plat** : nom, prix (chiffres seulement, virgule ou point), description, catégorie,
  photo principale et jusqu'à 4 photos supplémentaires (5 au total), options avec supplément
  (« Sauce », « Grande taille »…), allergènes.
- **Disponibilité programmée** : jours de la semaine, plage horaire, ou date unique (« plat
  du jour »). Le client voit « Pas aujourd'hui » ou la plage, et ne peut choisir qu'un
  créneau compatible.
- **Prix de revient** : saisi à la main, ou calculé automatiquement depuis la recette.
- **Stock** : quantité en stock, seuil d'alerte. Un plat suivi passe automatiquement en
  « Épuisé » à zéro et revient disponible au réapprovisionnement.
- **Recette** : liste d'ingrédients avec quantité par portion. Chaque vente consomme les
  ingrédients ; le nombre de portions réalisables limite le plat ; le coût matière alimente
  le prix de revient.
- **Disponible / Indisponible** : bascule manuelle sur chaque carte de plat.

## Stocks

Onglet **Plats** : alertes (épuisés, bientôt épuisés), filtres, recherche, et pour chaque
plat suivi : réapprovisionner, inventaire (fixer la quantité), déclarer une perte
(valorisée au prix de revient), arrêter le suivi. La carte « Mouvements de stock » liste
l'historique (vente, réappro, perte, inventaire, annulation, ajustement).

Onglet **Ingrédients et fournisseurs** :

- **Ingrédients** : nom, unité (g, kg, ml, l, pièce), stock, seuil d'alerte, prix unitaire,
  fournisseur, quantité de commande. Réception (avec nouveau prix d'achat), inventaire,
  perte.
- **Fournisseurs** : nom, contact, téléphone, e-mail, note.
- **Liste de courses** : ingrédients sous le seuil, groupés par fournisseur, avec quantité
  à commander et coût estimé ; export CSV.
- **Mouvements** : historique par ingrédient.

Un e-mail récapitulatif des stocks bas peut être envoyé chaque matin (tâche planifiée,
voir 02 · Installation).

## Ventes et clôture

- **Journal** : période (aujourd'hui, 7 jours, ce mois, personnalisée), regroupement par
  jour, semaine ou mois. Total, nombre de ventes, panier moyen, répartition par mode de
  paiement et par type, meilleur créneau, meilleure heure, remises accordées, ventes par
  employé, et **comparaison avec la période précédente**.
- **Export** CSV ou Excel, une ligne par article vendu, pour la comptabilité.
- **Clôture de journée** (« Z de caisse ») : aperçu puis enregistrement d'une photographie
  figée du jour (commandes, articles, totaux par mode de paiement, ventes en ligne et
  comptoir, annulations, pertes, résumé des articles), avec une note.

Un **bilan hebdomadaire** par e-mail (chiffre d'affaires, ventes, panier moyen comparés à
la semaine précédente, meilleurs produits, alertes, avis sans réponse) est disponible en
tâche planifiée.

## Clients et avis

- **Ma clientèle** : clients ayant commandé, nombre de commandes, total dépensé, panier
  moyen, première et dernière commande, plat préféré, note moyenne. Les coordonnées
  n'apparaissent que si le client les partage. Export CSV.
- **Avis** : notes et commentaires reçus ; « Répondre » publie une réponse visible sur la
  page publique (vide pour la retirer).

## Paramètres

- **Logo** : JPEG, PNG ou WebP, 5 Mo maximum, format carré recommandé. « Supprimer »
  revient à l'icône.
- **Profil restaurant** : nom, description, adresse, ville, téléphone. La cuisine et
  l'e-mail du compte sont modifiés par l'administration.
- **Statut** : le même interrupteur que dans le bandeau.
- **Horaires** : par jour, ouvert ou fermé, heure d'ouverture et de fermeture (une
  fermeture après minuit est acceptée). « Enregistrer les horaires ».
- **Temps de préparation et capacité** : temps de préparation moyen (premier créneau
  proposé), nombre maximum de commandes par créneau (0 = illimité).
- **Modes de commande et livraison** : sur place, à emporter, livraison ; frais fixes ou
  par zone de codes postaux, gratuité au-dessus d'un montant, commande minimum, jours et
  heures de livraison, message pour le client. Détails dans
  [Livraison et modes de commande](livraison-modes-commande.md).
- **Photos du restaurant** : jusqu'à 10 photos du lieu, légendes, choix de la bannière.
  Détails dans [Galerie photos](galerie-photos.md).
- **Fidélité et codes promo** : programme de fidélité (nombre de commandes avant récompense,
  récompense en pourcentage ou en euros) ; codes promo (pourcentage ou montant, minimum de
  commande, dates de validité, nombre d'utilisations maximal, actif ou non).
- **Équipe et codes PIN** : membres (caissier, cuisine, gérant) avec un PIN personnel de 4 à
  6 chiffres. Le PIN identifie qui encaisse ; seul un gérant peut quitter le mode caissier.
- **Mentions du ticket** : numéro de TVA et pied de ticket.
- **Impression** : impression automatique des tickets cuisine et client.
- **Notifications** : alerte sur cet appareil à chaque nouvelle commande, avec envoi de test.
- **Compte** : « Voir le site client » et déconnexion.

## Mode caissier

Conçu pour la tablette du comptoir. Le bouton « Mode caissier » demande le PIN d'un
employé, puis affiche un écran simplifié : commandes actives en grandes cartes avec
avancement et encaissement, vente comptoir, impression. L'employé identifié est enregistré
sur chaque action. Le mode survit à un rechargement de la page ; en sortir demande le PIN
d'un gérant (s'il en existe un).

## Bonnes pratiques

- Fermer l'interrupteur pendant une pause imprévue plutôt que de modifier les horaires.
- Renseigner les allergènes : ils sont affichés au client sur chaque plat.
- Clôturer la journée chaque soir : la clôture fige les chiffres même si une commande est
  modifiée ensuite.
- Sur la tablette, rester en mode caissier pendant le service : les nouvelles commandes
  arrivent en direct, avec impression automatique si elle est activée.
