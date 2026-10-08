# Rapport de recette — instance « Resto Préprod » — 8 octobre 2026

| | |
|---|---|
| Application testée | https://pick-eat-go-white-label.vercel.app |
| API | https://pickeatgo-whitelabel.onrender.com (version déployée `938e6b4e3f`, branche `main`) |
| Mode | `APP_MODE=single`, fuseau Europe/Brussels, mention « propulsé par » affichée |
| Méthode | Parcours automatisés dans Chromium (12 tailles d'écran) + appels directs à l'API, avec des données marquées **TEST** |
| Comptes utilisés | Éditeur `scott.kula.kula@gmail.com` (rôle admin) ; restaurateur `scott-kula-kula@hotmail.be` ; clients de test `test-client-…@example.com` |

Les captures sont dans `captures/`, les résultats bruts dans `resultats-R1-R14.json`, `resultats-R4-R13.json`,
`journal-passe-1.txt` et `journal-passe-2.txt`.

## 1. Synthèse

| Scénario | Résultat | En un mot |
|---|---|---|
| R1 Site public multi-écrans | **OK** | 33 vues sur 12 tailles d'écran : aucun débordement horizontal, aucune erreur JavaScript, aucun champ de saisie < 16 px |
| R2 Installation sur l'écran d'accueil | **À faire sur vrai téléphone** | Manifest et icônes vérifiés (R8) ; l'installation elle-même ne se teste que sur iPhone / Android |
| R3 Commande à emporter + suivi en direct | **OK** | Compte, panier avec option, commande #4502, étapes reçues en 3 à 5 s, paiement carte, note 5 ★ |
| R4 Livraison (zones, minimum, frais) | **OK** | Hors zone refusé, minimum 15 € appliqué, frais 2,50 €, commande #4503 suivie jusqu'à « livrée » |
| R5 Code promo et fidélité | **OK** | RECETTE10 = −10 %, récompense fidélité après 3 commandes, non-cumul (code prioritaire), annulation client |
| R6 Pas d'inscription restaurateur, pas de création de restaurant | **OK** | Inscription avec rôle restaurateur refusée (400) ; création de restaurant refusée (401 / 403) |
| R7 Cloisonnement de l'instance | **OK** | Un identifiant de restaurant autre que celui de l'instance répond 404 ; les écrans de la place de marché (validation, contrats) sont absents |
| R8 « Mon application » visible sur le site | **OK** | Carte du restaurateur (identité, icônes, textes légaux, lien & QR) ; slogan, logo, réseaux, mentions légales et manifest reflètent la marque saisie |
| R9 E-mails de marque | **Non testable ici** | SMTP non configuré sur l'instance (fiche : « console, non envoyés ») |
| R10 Mode caissier (PIN employé) | **OK** | PIN inconnu refusé, PIN caissier accepté, commande enregistrée au nom de l'employée, sortie réservée au gérant, survit au rechargement |
| R11 Interrupteur « fermé » | **OK** | Bandeau « Fermé », carte consultable, commande refusée par l'API (400), réouverture OK |
| R12 Console éditeur | **OK** | Fiche d'instance exacte, menus de la plateforme absents, utilisateurs limités à l'instance |
| R13 Plateforme PickEatGo inchangée | **OK** | https://pick-eat-go.vercel.app affiche toujours l'accueil multi-restaurants avec recherche |
| R14 Ergonomie tactile et lisibilité | **OK avec réserve** | Quelques cibles tactiles < 40 px dans le pied de page (corrigées dans ce lot, à déployer) |
| R15 Outillage de création d'instance | **OK en simulation** | `create_instance.py --dry-run` produit les 6 étapes attendues ; la création réelle demande vos clés Render / Vercel |

Bilan : **12 scénarios validés**, 1 validé avec réserve (R14), 1 validé en simulation (R15), 2 à réaliser sur vos
appareils ou après configuration (R2, R9).

## 2. Détail par scénario

### R1 — Site public sur 12 tailles d'écran
Écrans : Android 320 px, Galaxy S8, iPhone SE, iPhone 14, Pixel 7, iPhone Max, téléphone en paysage, iPad mini,
iPad paysage, iPad Pro, portable 1366 px, bureau 1280 px. Pages : accueil, carte, à propos, mentions légales, connexion.

- Débordement horizontal : 0 sur les 33 vues.
- Erreurs JavaScript : 0 (une seule exception : à la première ouverture de la page de connexion, l'appel de santé de
  l'API a été bloqué par CORS pendant un réveil du service Render ; l'appel suivant est passé, l'en-tête CORS est présent).
- Aucun champ de saisie en dessous de 16 px sur mobile (pas de zoom automatique iOS).
- L'accueil ne montre ni recherche, ni filtres de cuisine, ni autre restaurant ; le pied de page et la mention
  « Application propulsée par PickEatGo » sont présents.
- La page de connexion n'a pas de sélecteur de rôle et porte le nom du restaurant.

![Accueil iPhone SE](captures/R1-home-iphone-se.png)
![Carte iPhone 14](captures/R1-menu-iphone-14.png)
![Accueil Android 320 px](captures/R1-home-android-320.png)
![Accueil bureau](captures/R1-home-desktop.png)
![À propos iPad mini](captures/R1-about-ipad-mini.png)
![Connexion iPhone SE](captures/login-iphone-se.png)

### R3 — Commande à emporter et suivi en direct
1. Création d'un compte client depuis l'API d'inscription (rôle client imposé) : 201.
2. Panier : « TEST Burger Classic » avec option Bacon (+1,00 €) et « TEST Frites Maison » ; commande #4502,
   total 14,00 € conforme (9,50 + 1,00 + 3,50).
3. Le restaurant (compte éditeur) fait avancer la commande ; côté client, sans recharger la page :
   « Confirmée » en 3,6 s, « En cuisine » en 4,6 s, écran « Prête à récupérer » en 4,5 s, écran « Bon appétit » en 5,0 s.
4. Remise avec paiement **carte** : statut `recuperee`, paiement enregistré, note 5 ★ et commentaire envoyés.
5. Aucune erreur JavaScript pendant le parcours.

![Confirmation](captures/R3-confirm.png)
![Prête](captures/R3-prete.png)
![Bon appétit](captures/R3-bon-appetit.png)

### R4 — Livraison
Réglages de test : zones 1000 et 1050, frais 2,50 €, minimum 15 €, offerts dès 40 €.

- Code postal 9999 : message « Nous ne livrons pas encore le code postal 9999 », bouton désactivé « Adresse non desservie ».
- Code postal 1000 avec 2,50 € de panier : bouton « Minimum 15,00 € pour la livraison », frais 2,50 € annoncés.
- Panier à 23,50 € : commande #4503 créée avec adresse, code postal, frais 2,50 €, total 26,00 €.
- Cycle complet : prête → « En livraison » affiché chez le client en moins d'une seconde → livrée (paiement espèces).

![Hors zone](captures/R4-hors-zone.png)
![Commande livraison](captures/R4-livraison.png)
![En livraison](captures/R4-en-livraison.png)
![Livrée](captures/R4-livree.png)

### R5 — Code promo et fidélité
Réglages de test : code RECETTE10 (−10 %), fidélité 3 commandes → −10 %.

- Commande #4504 avec RECETTE10 : remise 1,00 € sur 10,00 €, total 9,00 €, une seule remise.
- Après 3 commandes remises (#4502, #4503, #4504) : « Récompense fidélité prête ! » dans le panier, −0,95 € appliqués.
- Code promo saisi en plus : le code prend la place de la récompense, message « non cumulable avec un code promo,
  le code est prioritaire », une seule ligne de remise.
- Commande #4506 passée avec le code puis annulée par le client tant qu'elle est « nouvelle » : statut `annulee`,
  tampons conservés (3/3).
- Commande #4507 passée avec la récompense : `loyalty_reward = true`, remise 0,95 €, compteur remis à 0 après remise.

![Code promo](captures/R5-promo.png)
![Fidélité prête](captures/R5-fidelite.png)
![Promo et fidélité](captures/R5-promo-et-fidelite.png)

### R6 / R7 — Périmètre mono-restaurant
- Inscription avec `role=restaurateur` : 400. Création d'un restaurant par un client : 401 / 403.
- Toute requête visant un identifiant de restaurant autre que celui de l'instance répond 404 ; les routes de la place de marché (validation des restaurants, contrats) répondent 404.

### R8 — « Mon application » visible sur le site
- Slogan « Le vrai goût maison, prêt à l'heure que vous voulez », logo dans la barre, boutons Site web et Instagram.
- Mentions légales : raison sociale, numéro d'entreprise, TVA, siège, responsable, téléphone, e-mail.
  Les conditions de commande et la politique de confidentialité sont encore « en cours de rédaction »
  (textes à saisir dans Mon application → Textes légaux ; des modèles sont fournis dans `docs/modeles-legaux.md`).
- Manifest : nom « Resto Préprod », nom court « Resto Prépro », 3 icônes Cloudinary (192, 512, maskable),
  raccourcis « Commander » et « Mes commandes ».

Côté restaurateur, Paramètres → Mon application : onglets Identité, Icônes, Coordonnées & réseaux, Textes légaux (⚠ tant que
les conditions et la confidentialité ne sont pas saisies), Lien & QR code (adresse publique, QR à télécharger) et Publication.

![Accueil avec marque](captures/R8-home.png)
![Mentions légales](captures/R8-legal.png)
![Mon application — identité](captures/R8-myapp-identite.png)
![Mon application — icônes](captures/R8-myapp-icones.png)
![Mon application — textes légaux](captures/R8-myapp-legal.png)
![Mon application — lien et QR](captures/R8-myapp-qr.png)

### R10 — Mode caissier
Équipe de test : Sarah TEST (caissier, PIN 4826), Marco TEST (gérant, PIN 7391).

- Bouton « Mode caissier » du tableau de bord : clavier PIN, « 2 membre(s) de l'équipe ». Code 0000 refusé (« Code incorrect »).
- Code 4826 : écran caisse plein écran, bandeau « Sarah TEST (Caissier) », colonnes Nouvelles / En cours / Prêtes.
- Commande #4509 confirmée depuis la caisse : enregistrée avec `employee_name = Sarah TEST`.
- « Quitter » : demande le code d'un gérant ; 4826 refusé, 7391 accepté, retour au tableau de bord.
- Après rechargement de la page, la caisse reste ouverte (tablette au comptoir).

![Tableau de bord](captures/R10-dashboard.png)
![PIN refusé](captures/R10-pin-refuse.png)
![Caisse](captures/R10-caissier.png)
![Sortie refusée sans gérant](captures/R10-sortie-refusee.png)

### R11 — Interrupteur « fermé »
Interrupteur basculé par l'API : accueil « ● Fermé », bouton « Fermé · voir la carte → », bandeau « Le restaurant
n'accepte pas de commande pour le moment », commande refusée (400, « Ce restaurant est actuellement fermé »).
Réouverture : « Ouvert · ferme à 23:59 ».

![Fermé](captures/R11-ferme.png)

### R12 — Console éditeur
Menu : Dashboard, Instance, Utilisateurs, Signalements, Statistiques, Paramètres (pas de Restaurants ni de Contrats).
Fiche d'instance : application, restaurant, titulaire, mise en service, identifiant, domaine, API, version
`938e6b4e3f (main)`, dernier démarrage, services (Postgres, Redis, Cloudinary OK ; SMTP non configuré ; VAPID OK).
Utilisateurs : uniquement le restaurateur et les clients de test de l'instance.

![Console](captures/R12-console.png)
![Utilisateurs](captures/R12-utilisateurs.png)

### R13 — Plateforme inchangée
![Plateforme](captures/R13-plateforme.png)

### R15 — Outillage (simulation)
`python tools/create_instance.py tools/instances/example.json --dry-run` affiche les appels prévus : Postgres,
Key Value, service web avec toutes les variables d'instance, job `bootstrap_tenant --restaurant-id …`,
déploiement initial, deux cron jobs, projet Vercel et domaine, puis la fiche de registre. Aucun appel réel n'a été fait.

## 3. Anomalies trouvées et corrections (branche `claude/modest-carson-hlgwyd`)

| # | Constat | Correction |
|---|---|---|
| A1 | Pied de page : liens téléphone / e-mail (17 px) et boutons Accueil / À propos / Mentions légales (29 px) sous les 40 px recommandés ; idem « Infos pratiques, horaires complets et avis → » | Hauteur minimale 40 px sur ces éléments (`frontend/app/single.jsx`) |
| A2 | Taper `/#menu` ou `/#legal` dans la barre d'adresse alors que le site est déjà ouvert ramenait à l'accueil | Le changement d'ancre est maintenant lu depuis l'URL (`frontend/lib/useHistoryPage.js`) |
| A3 | Un client en livraison qui rechargeait la page pendant l'étape « En livraison » perdait l'écran de suivi | L'étape 4 est restaurée comme les autres (`frontend/app/page.jsx`) |
| A4 | L'accueil affichait « ★ 5 (0 commandes) » : le compteur de commandes du restaurant n'était jamais incrémenté | Incrément à chaque commande remise au client (`backend/apps/orders/models.py`) |
| A5 | Le journal technique de la fiche d'instance restait vide (0 entrée) même après des erreurs 500 | Les erreurs de requêtes, de sécurité et de base alimentent le journal, avec la fin de la trace (`backend/pickeatgo/settings_prod.py`, `apps/tenant/logbuffer.py`) |
| A6 | **Photos de plat et photos du lieu : erreur 500 en production.** Cause trouvée en reproduisant localement : l'identifiant Cloudinary `pickeatgo-single/menus/<restaurant>/<plat>-xxxxxxxx` fait 105 caractères, la colonne n'en acceptait que 100 (la plateforme utilisait le dossier plus court `pickeatgo`). Le logo (80 caractères) passait, d'où la confusion | Colonnes image portées à 255 caractères (migrations `menus 0006`, `restaurants 0013`, `tenant 0002`, `accounts 0003`, appliquées automatiquement au démarrage du service) + test de non-régression `tests/test_uploads_long_folder.py` |

Vérifications faites avant envoi : build Next.js OK, 140 tests en mode single et 141 tests en mode plateforme passés.

### À vérifier après déploiement
Envoyer une photo de plat et une photo du lieu depuis le tableau de bord (A6) : l'URL retournée doit commencer par
`https://res.cloudinary.com/`. Les plats de test ont été créés sans photo.

### Remarques mineures (non corrigées)
- Panier en livraison : tant que le code postal n'est pas desservi, la ligne « Frais de livraison » affiche « Offerts ».
- Écran de confirmation d'une livraison : « Livraison vers 10:40 · Livraison » répète le mot.
- Sur ordinateur, le bouton « + » des plats fait 28 px (à la souris, acceptable ; sur mobile le plat s'ouvre en plein écran).

## 4. Ce qui reste à faire par vous

1. **R2 — Installation** : sur un iPhone (Safari → Partager → Sur l'écran d'accueil) et un Android (Chrome → Installer) :
   icône, nom court, écran de démarrage, ouverture directe sur l'accueil du restaurant.
2. **Notifications push** : depuis le téléphone installé, activer « Recevez une notification… » sur l'écran de suivi
   puis faire avancer une commande depuis le tableau de bord : la notification doit arriver même application fermée.
3. **R9 — E-mails** : une fois le SMTP configuré (variables `EMAIL_*` sur Render), vérifier l'e-mail de bienvenue,
   de confirmation de commande et de réinitialisation de mot de passe (nom, logo et couleur du restaurant, pas de
   mention PickEatGo autre que le badge si activé).
4. **Impression** : ticket de commande et clôture de caisse sur votre imprimante.
5. **R15 — Création réelle d'une instance** avec `RENDER_API_KEY` et `VERCEL_TOKEN` (voir `docs/12-creer-une-instance.md`).
6. **Textes légaux** : saisir les conditions de commande et la politique de confidentialité (modèles fournis),
   ce qui termine la liste de publication.
7. **Reportés à plus tard (déjà notés)** : domaine personnalisé (étape 9) et cron jobs `stock_digest` / `weekly_report`
   (étape 10, après le SMTP).
8. **Sécurité** : changer le mot de passe de l'éditeur et du restaurateur après la recette (ils ont circulé par écrit).

## 5. Données de test à supprimer après la recette

- Clients : `test-client-muz9m55c@example.com`, `test-client-muz9ooc9@example.com`, `test-client-muz9wdi4@example.com`,
  `test-client-muz9wt3y@example.com` (Console éditeur → Utilisateurs).
- Commandes #4501 à #4509 (historique ; elles comptent dans le chiffre d'affaires affiché).
- Plats « TEST … » (9), code promo RECETTE10, employés Sarah TEST et Marco TEST, zones de livraison 1000 / 1050.
- Textes « (TEST) » dans Mon application (slogan, à propos, mentions légales) et horaires 00:01–23:59.
- Un avis 5 ★ « Avis de recette (TEST) ».
