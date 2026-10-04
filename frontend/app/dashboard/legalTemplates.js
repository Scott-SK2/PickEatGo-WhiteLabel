/**
 * dashboard/legalTemplates.js — Modèles de conditions de commande et de politique de confidentialité
 * fournis par l'éditeur pour l'édition Marque Blanche. Le restaurateur les insère dans
 * « Mon application → Textes légaux », relit et complète les passages entre crochets.
 * Le même texte existe en version Markdown dans docs/modeles-legaux.md.
 */
const v = (x, fallback) => (x && String(x).trim()) || fallback;

export const LEGAL_TEMPLATES = {
  terms: (form, restaurant) => {
    const name = v(form.legal_name, v(restaurant?.name, "[Raison sociale]"));
    const app = v(form.app_name, v(restaurant?.name, "[Nom de l'application]"));
    const addr = v(form.legal_address, v(restaurant?.address, "[adresse du siège]"));
    return `1. Objet
Les présentes conditions régissent les commandes passées via l'application ${app}, exploitée par ${name}, ${addr}${form.company_number ? ` (n° d'entreprise ${form.company_number})` : ""}.

2. Commande
Le client choisit ses articles, un mode de service (sur place, à emporter ou livraison selon disponibilité) et un créneau. La commande est enregistrée dès l'écran de confirmation ; un e-mail récapitulatif est envoyé. Le restaurant peut refuser une commande en cas d'indisponibilité : le client est alors prévenu et aucun montant n'est dû.

3. Prix et paiement
Les prix sont indiqués en euros, TVA comprise. Le paiement s'effectue à la remise de la commande ou à la livraison (espèces ou carte selon les moyens acceptés par le restaurant). Les codes promotionnels et avantages de fidélité s'appliquent selon les conditions affichées dans le panier ; une seule remise par commande.

4. Retrait et livraison
Le créneau choisi est indicatif et tient compte du temps de préparation. Les commandes non retirées dans les [30 minutes] suivant le créneau peuvent être considérées comme abandonnées. En livraison, l'adresse et le code postal communiqués doivent être exacts ; les frais et le minimum de commande sont affichés avant validation.

5. Annulation
Le client peut annuler sa commande depuis l'application tant qu'elle n'a pas été confirmée par le restaurant. Au-delà, il contacte directement le restaurant au [téléphone].

6. Allergènes
Les allergènes signalés sur les fiches des plats le sont à titre d'information. En cas d'allergie, précisez-le dans la note de commande ou contactez le restaurant avant de commander.

7. Réclamations
Toute réclamation est adressée à ${name}, ${addr}, ou par e-mail à [adresse e-mail de contact]. Le droit belge est applicable ; en cas de litige, une solution amiable est recherchée avant toute action.`;
  },
  privacy: (form, restaurant, platformName = "PickEatGo") => {
    const name = v(form.legal_name, v(restaurant?.name, "[Raison sociale]"));
    const app = v(form.app_name, v(restaurant?.name, "[Nom de l'application]"));
    const addr = v(form.legal_address, v(restaurant?.address, "[adresse du siège]"));
    return `Responsable du traitement
${name}, ${addr}, est responsable du traitement des données personnelles collectées via l'application ${app}. Contact : [adresse e-mail de contact]. L'application est fournie et hébergée par ${platformName}, qui agit en qualité de sous-traitant.

Données collectées
Compte : prénom, nom, adresse e-mail, numéro de téléphone (avec votre choix de le partager ou non avec le restaurant), mot de passe (chiffré).
Commandes : articles, créneau, mode de service, adresse de livraison le cas échéant, note, notation et commentaire éventuels.
Technique : identifiants de session, abonnement aux notifications (si vous l'activez), journaux de sécurité.

Finalités et bases légales
Traitement et suivi de vos commandes (exécution du contrat) ; envoi des e-mails et notifications liés à vos commandes (exécution du contrat) ; programme de fidélité et codes promotionnels (exécution du contrat) ; sécurité et prévention des abus (intérêt légitime) ; obligations comptables (obligation légale).

Destinataires
Le restaurant et son équipe pour la préparation et la remise de votre commande ; ${platformName} pour l'hébergement, la maintenance et le support technique ; les prestataires d'hébergement, d'envoi d'e-mails et de stockage d'images, situés dans l'Union européenne ou offrant des garanties équivalentes.

Durée de conservation
Compte : jusqu'à sa suppression, puis [3 ans] d'inactivité. Commandes : [10 ans] à des fins comptables. Abonnements aux notifications : jusqu'à désactivation.

Vos droits
Vous pouvez accéder à vos données, les rectifier, demander leur suppression ou leur portabilité, et vous opposer à certains traitements, en écrivant à [adresse e-mail de contact]. Vous pouvez aussi introduire une réclamation auprès de l'Autorité de protection des données (autoriteprotectiondonnees.be).

Cookies et stockage local
L'application utilise uniquement le stockage local du navigateur pour maintenir votre session, mémoriser votre panier et vos préférences. Aucun traceur publicitaire n'est utilisé.`;
  },
};
