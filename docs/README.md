# Documentation PickEatGo

PickEatGo est une plateforme de précommande et de gestion pour restaurants indépendants.
Le client commande en ligne (sur place, à emporter ou en livraison) et suit sa commande en
temps réel ; le restaurateur pilote ses commandes, sa caisse, son menu, ses stocks et ses
ventes depuis un tableau de bord utilisable sur tablette et téléphone ; l'administration
valide les restaurants et gère les contrats. L'**édition Marque Blanche** livre le même logiciel
à un seul restaurant, sous son nom et son domaine (mode `single`, documents 11 à 13).

| Document | Pour qui | Contenu |
|---|---|---|
| [01 · Présentation](01-presentation.md) | Tous | Ce que fait le logiciel, les trois rôles, la pile technique, l'hébergement |
| [02 · Installation et déploiement](02-installation.md) | Technique | Lancer en local, variables d'environnement, Render, Vercel, tâches planifiées, compte admin |
| [03 · Guide client](03-guide-client.md) | Utilisateurs | Rechercher, commander, suivre, noter, favoris, fidélité, notifications |
| [04 · Guide restaurateur](04-guide-restaurateur.md) | Restaurateurs | Tableau de bord : commandes, caisse, menu, stocks, ventes, clients, paramètres, mode caissier |
| [05 · Guide administration](05-guide-admin.md) | Administration | Validation des restaurants, utilisateurs, signalements, contrats et facturation |
| [06 · Architecture technique](06-architecture.md) | Développeurs | Backend Django, frontend Next.js, temps réel, services métier, PWA |
| [07 · Référence API](07-api.md) | Développeurs | Tous les points d'entrée REST et le protocole WebSocket |
| [08 · Sécurité et données](08-securite.md) | Technique | Authentification, permissions par rôle, données personnelles, limites |
| [09 · Tests et qualité](09-tests-qualite.md) | Développeurs | Suite pytest, intégration continue, harnais responsive, données de démonstration |
| [10 · Exploitation](10-exploitation.md) | Technique | Tâches planifiées, incidents fréquents, sauvegardes, check-list de mise en production |
| [Galerie photos](galerie-photos.md) | Tous | Photos du restaurant et des plats, visionneuse |
| [Livraison et modes de commande](livraison-modes-commande.md) | Tous | Sur place, à emporter, livraison, frais et créneaux |
| [11 · Édition Marque Blanche](11-marque-blanche.md) | Technique | Mode mono-restaurant (`APP_MODE=single`), variables d'instance, règles, modèle Branding, API `/branding/`, frontend |
| [12 · Créer une instance](12-creer-une-instance.md) | Éditeur | Procédure Render + Vercel, `bootstrap_tenant`, outillage `tools/create_instance.py`, pré-production, versions, fin de contrat |
| [13 · Mon application](13-guide-mon-application.md) | Restaurateurs licenciés | Identité, icônes, coordonnées et réseaux, textes légaux, lien et QR code, état de publication |
| [Modèles légaux](modeles-legaux.md) | Restaurateurs licenciés | Mentions légales, conditions de commande et politique de confidentialité à compléter |

Conventions : les chemins sont donnés depuis la racine du dépôt ; les routes API sont
préfixées par `/api/v1/` ; les libellés entre guillemets sont ceux de l'interface.
