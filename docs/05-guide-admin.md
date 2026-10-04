# 05 · Guide administration

La console est accessible à `/admin` avec un compte de rôle admin (création : voir
02 · Installation). L'interface d'administration Django reste disponible sur l'API à
`/admin/` pour les opérations exceptionnelles.

## Dashboard

Indicateurs globaux (restaurants, utilisateurs, commandes, revenus dus), restaurants en
attente de validation avec validation en un clic, répartition des restaurants par statut,
accès rapides (administration Django, documentation de l'API, actualisation).

## Restaurants

Liste avec recherche et filtres Tous / Actifs / En attente / Suspendus. La fiche détaille le
propriétaire, l'e-mail, le téléphone, la cuisine, les horaires et les statistiques.

- **Valider** : le restaurant passe d'« en attente » à « actif » et apparaît sur le site
  public. C'est l'étape indispensable après chaque inscription d'un restaurateur.
- **Suspendre** : le restaurant disparaît du site public ; son propriétaire conserve l'accès
  au tableau de bord.
- **Supprimer** : irréversible, avec confirmation.

## Utilisateurs

Clients et restaurateurs, recherche par nom ou e-mail, filtre actifs / bloqués. Un compte
peut être **bloqué** (il ne peut plus se connecter) ou **supprimé**. Les comptes admin ne
sont pas listés ici : ils se gèrent dans l'administration Django.

## Signalements

Signalements déposés par les utilisateurs à propos d'un restaurant ou d'un autre
utilisateur, avec gravité. « Résoudre » ou « Classer sans suite » met à jour le statut.

## Contrats et facturation

Chaque restaurant a un modèle de contrat :

| Modèle | Calcul du montant dû |
|---|---|
| Commission | pourcentage du chiffre d'affaires |
| Abonnement | forfait mensuel |
| Mixte | commission + forfait |

S'y ajoute un supplément de mise en avant si le restaurant est « en vedette ». La fiche
contrat permet de régler le pourcentage, les forfaits, le jour de facturation, la mise en
avant, la gestion du menu par l'administration, des notes, et de marquer la facture comme
payée. La liste signale les impayés et le total dû ce mois.

Les champs de contrat ne sont visibles que de l'administration et du propriétaire du
restaurant ; ils ne sont jamais exposés au public.

## Statistiques

Vue d'ensemble de l'activité de la plateforme (commandes, revenus, restaurants,
utilisateurs).

## Paramètres

Informations sur la plateforme et liens utiles.

## Ce que l'administration ne fait pas dans la console

- Créer des comptes admin : administration Django ou variables `ADMIN_*`.
- Modifier le menu d'un restaurant : uniquement si « menu géré par l'administration » est
  coché sur le contrat, via le tableau de bord du restaurateur (compte admin autorisé sur
  tous les restaurants dans l'API).
- Changer la cuisine ou l'e-mail d'un restaurant : administration Django.
