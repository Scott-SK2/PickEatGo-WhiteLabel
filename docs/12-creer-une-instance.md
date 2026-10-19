# 12 · Créer une instance Marque Blanche (guide de l'éditeur)

Une instance = un trio Render (service web, Postgres, Key Value) + un projet Vercel, créés à
partir du dépôt commun (branche `main`) avec les variables du restaurant. Objectif : une
demi-journée à la main, moins d'une heure avec l'outillage.

## Procédure manuelle (première instance)

1. **Postgres** (région Frankfurt, plan payant) et **Key Value** (`allkeys-lru`), nommés d'après
   le restaurant (`burger-house-db`, `burger-house-kv`). Récupérer les URL internes.
2. **Service web** Python, dépôt commun, branche `main`, dossier `backend`, build et commande de
   démarrage identiques à `backend/DEPLOY_RENDER.md`, health check `/api/v1/health/`.
   Variables : celles de la plateforme (`SECRET_KEY` propre, `DATABASE_URL`, `REDIS_URL`,
   `ENV=production`, Cloudinary avec `CLOUDINARY_FOLDER=pickeatgo-<slug>`, SMTP, `ADMIN_EMAIL` /
   `ADMIN_PASSWORD`) **plus** `APP_MODE=single`, `TENANT_TIMEZONE`, `POWERED_BY_BADGE`,
   `FRONTEND_URL` et `CORS_ALLOWED_ORIGINS` = adresse publique de l'application.
3. **Amorçage** dans le shell du service :
   ```
   python manage.py bootstrap_tenant --name "Burger House" --email marie@burgerhouse.be \
       --address "12 Rue de la Paix, 1000 Bruxelles" --phone "+32 2 123 45 67" --cuisine Américain
   ```
   La commande migre la base, crée le compte restaurateur (mot de passe généré et affiché une
   fois si `--password` est absent), le restaurant actif, les quatre catégories, les horaires par
   défaut (11:30–22:00, week-end jusqu'à 22:30) et la marque par défaut, puis affiche
   `TENANT_RESTAURANT_ID=<uuid>`. Elle est idempotente. Avec `--restaurant-id <uuid>`, l'identifiant
   est imposé (outillage : il peut être renseigné dans les variables avant le premier déploiement).
4. **Reporter `TENANT_RESTAURANT_ID`** dans les variables du service et redéployer. Tant que
   l'identifiant est vide, l'API démarre avec l'avertissement `tenant.W001` et répond « instance
   non configurée » ; s'il désigne un restaurant inexistant, le service refuse de démarrer.
5. **Clés VAPID** : `python manage.py generate_vapid_keys` dans le shell, coller les trois variables.
6. **Vercel** : projet lié au dépôt, dossier `frontend`, `NEXT_PUBLIC_API_URL=https://<service>.onrender.com/api/v1`,
   `NEXT_PUBLIC_WS_URL=wss://<service>.onrender.com`. Attacher le sous-domaine PickEatGo
   (`<slug>.pickeatgo.app`) ou le domaine du restaurant (CNAME `cname.vercel-dns.com` fourni au restaurateur).
7. Ajouter l'origine du frontend dans `CORS_ALLOWED_ORIGINS` si elle a changé ; créer les cron jobs
   `stock_digest` (`0 7 * * *`) et `weekly_report` (`0 8 * * 1`) avec les mêmes variables.
8. Remettre les accès au restaurateur : il complète **Paramètres → Mon application** (identité,
   icônes, textes légaux), ses horaires, son menu et ses modes de commande, puis ouvre.
   Il change son mot de passe initial dans « Mon profil » (`/#profile`). En cas d'oubli sans SMTP :
   Console éditeur → Utilisateurs → 🔑 **Réinitialiser le mot de passe** génère un mot de passe
   temporaire affiché une seule fois (les sessions ouvertes du compte sont fermées).
9. Lister l'instance dans le registre interne (`tools/instances/registry.json`, non versionné :
   nom, domaine, identifiants des services, date de mise en service, contact).

## Outillage (dès la troisième instance)

```
export RENDER_API_KEY=… VERCEL_TOKEN=… [VERCEL_TEAM_ID=…]
cp tools/instances/example.json tools/instances/burger-house.json   # puis compléter
python tools/create_instance.py tools/instances/burger-house.json --dry-run   # affiche les appels
python tools/create_instance.py tools/instances/burger-house.json
```

Le script (bibliothèque standard uniquement) génère l'identifiant du restaurant et la
`SECRET_KEY`, crée Postgres, Key Value et le service web avec toutes les variables (déploiement
automatique coupé le temps de l'amorçage), lance un job `bootstrap_tenant --restaurant-id`, déclenche
le premier déploiement, crée les deux cron jobs, crée le projet Vercel et attache le domaine, puis
inscrit l'instance dans le registre. Il affiche le mot de passe initial du restaurateur et ce qui
reste manuel (clés VAPID, vérification DNS, retrait d'`ADMIN_PASSWORD`). Les noms de ressources,
plans et régions se règlent dans le fichier de paramètres.

## Pré-production

Un service Render + un projet Vercel en mode single, sur une base dédiée, suivent la branche
`main` (ou une branche de validation) : chaque version y est rejouée (scénarios R1 à R15 du
cahier des charges) avant fusion. L'audit responsive automatisé (`tools/audit-responsive.js`)
s'exécute contre cette instance avec `APP_MODE=single`.

## Mises à jour et versions

- Toutes les instances suivent `main` : une fusion déploie partout (Render et Vercel en
  auto-deploy). Un déploiement manuel par instance reste possible pour échelonner.
- Chaque instance affiche sa version (commit `RENDER_GIT_COMMIT`), son dernier démarrage et l'état
  de ses services dans la **console éditeur → Instance** (`GET /api/v1/branding/instance/`).
- Les migrations s'exécutent au démarrage et restent compatibles avec les deux modes.

## Fin de contrat

Exporter les données du restaurateur (ventes CSV / Excel, clientèle CSV depuis le tableau de
bord ; sauvegarde Postgres pour l'éditeur), puis supprimer le service, la base, le Key Value, le
projet Vercel et le dossier Cloudinary de l'instance après le délai convenu. Retirer l'entrée du registre.

## Sécurité et isolation

Base, dossier d'images, clés VAPID et secrets distincts par instance ; les accès de l'éditeur
sont nominatifs (compte administration) ; le restaurateur n'a pas d'accès technique. Les règles de
sécurité de PickEatGo (jetons, permissions, limites de débit, verrous, exports neutralisés,
en-têtes de production) s'appliquent sans changement : voir [08 · Sécurité](08-securite.md).
