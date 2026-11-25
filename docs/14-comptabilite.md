# 14 · Comptabilité : rapport PDF et envoi au comptable

Le tableau de bord produit un rapport comptable de n'importe quelle période et peut l'envoyer chaque mois
au comptable du restaurant. Aucune donnée bancaire n'est concernée : le rapport porte sur les ventes
enregistrées dans l'application.

## Pour le restaurateur

**Paramètres → Comptabilité**

- *TVA sur place* et *TVA à emporter / livraison* : les prix de la carte sont TTC, ces taux servent à
  ventiler la TVA. Valeurs par défaut : 12 % et 6 % (restauration en Belgique). À faire valider par le comptable.
- *Ventes au comptoir consommées sur place* : coché, les ventes encaissées au comptoir prennent le taux « sur place ».
- *E-mail du comptable* et *envoi automatique* : le 1er du mois, le rapport du mois écoulé part chez le
  comptable, le restaurateur en copie.
- *Rapport comptable d'un mois* : choisir le mois, télécharger le PDF ou l'envoyer tout de suite.

**Fiche d'un plat → TVA propre à ce plat** : pour un produit qui garde le même taux quel que soit le mode de
service (par exemple 21 % pour une boisson alcoolisée). Vide, le plat suit les taux du restaurant.

**Ventes → PDF comptable / Au comptable** : même rapport, sur la période affichée à l'écran.

## Contenu du PDF

1. Identité : raison sociale, numéro d'entreprise et de TVA (repris de Mon application → Textes légaux).
2. Synthèse : chiffre d'affaires TTC et HT, TVA collectée, nombre de ventes, remises, frais de livraison, annulations.
3. TVA par taux : base HT, TVA, total TTC.
4. Encaissements par mode de paiement : espèces, carte, en ligne.
5. Ventes par mode de service : sur place, à emporter, livraison, comptoir.
6. Journal des ventes par jour, avec l'indication des jours clôturés.
7. Clôtures de caisse : qui a clôturé, totaux figés, écart éventuel (ventes saisies après la clôture).
8. Méthode de calcul, en pied de document.

L'envoi par e-mail joint aussi le détail des ventes ligne par ligne (tableur).

## Règles de calcul

- Une vente est une commande remise au client. Les commandes annulées ne sont pas comptées.
- Le taux de TVA de chaque ligne est figé au moment de la commande : changer un taux ne modifie pas les ventes
  passées. Les ventes antérieures à cette fonction sont calculées avec les taux actuels.
- Une remise (code promo, fidélité) est répartie sur les lignes au prorata. Les frais de livraison suivent le
  taux « à emporter ».
- La TVA est calculée par taux sur le total TTC de la période : HT = TTC / (1 + taux), TVA = TTC − HT.

Le rapport est un document de gestion destiné au comptable. Il ne remplace ni un système de caisse
enregistreuse certifié, ni les obligations déclaratives du restaurant.

## Pour l'éditeur

- API : `GET /api/v1/orders/accounting/?restaurant=&month=YYYY-MM` (ou `from`/`to`), `&type=pdf` pour le document ;
  `POST /api/v1/orders/accounting/send/` pour l'envoi. Réservé au propriétaire et à l'éditeur.
- Envoi mensuel : cron job `0 6 1 * *` → `python manage.py monthly_accounting` (`--month YYYY-MM`, `--dry-run`).
  Créé par `tools/create_instance.py`. Nécessite le SMTP ; sans lui, le bouton d'envoi explique que l'e-mail
  n'est pas configuré et le PDF reste téléchargeable.
- Dépendance ajoutée : `reportlab` (génération du PDF).
