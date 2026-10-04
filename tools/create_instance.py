#!/usr/bin/env python3
"""
tools/create_instance.py — Création d'une instance Marque Blanche (Render + Vercel) depuis un fichier de paramètres.

    python tools/create_instance.py instances/burger-house.json [--dry-run] [--registry tools/instances/registry.json]

Le fichier de paramètres (voir tools/instances/example.json) décrit le restaurateur, le domaine,
les secrets partagés (Cloudinary, SMTP) et les identifiants Render / Vercel. Le script :

  1. génère l'identifiant du restaurant (TENANT_RESTAURANT_ID) et la SECRET_KEY de l'instance ;
  2. crée sur Render une base Postgres, un Key Value et le service web (dépôt commun, branche main,
     déploiement automatique désactivé le temps de l'amorçage) avec toutes les variables d'instance ;
  3. lance un job Render `bootstrap_tenant --restaurant-id <uuid>` (compte, restaurant, catégories, horaires, marque) ;
  4. déclenche le premier déploiement, puis crée les cron jobs stock_digest (7 h) et weekly_report (lundi 8 h) ;
  5. crée le projet Vercel (dossier frontend, NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL) et attache le domaine ;
  6. ajoute l'instance au registre interne de l'éditeur (nom, domaine, identifiants des services, date, contact).

Les clés VAPID restent à générer dans le shell du service (`python manage.py generate_vapid_keys`) puis à
coller dans les variables : elles ne transitent pas par ce script. Avec --dry-run, aucun appel n'est fait :
les requêtes prévues sont affichées.

Dépendances : bibliothèque standard uniquement. Variables d'environnement : RENDER_API_KEY, VERCEL_TOKEN
(et VERCEL_TEAM_ID si le projet appartient à une équipe).
"""
import argparse
import json
import os
import secrets
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib import request, error

RENDER_API = "https://api.render.com/v1"
VERCEL_API = "https://api.vercel.com"


class Api:
    def __init__(self, base, token, dry_run=False, extra_query=None):
        self.base, self.token, self.dry_run, self.extra_query = base, token, dry_run, extra_query or {}

    def call(self, method, path, body=None):
        url = self.base + path
        if self.extra_query:
            url += ("&" if "?" in url else "?") + "&".join(f"{k}={v}" for k, v in self.extra_query.items())
        print(f"  {method} {url}")
        if body is not None:
            print("    " + json.dumps(body, ensure_ascii=False)[:600])
        if self.dry_run:
            return {"id": f"dry-{uuid.uuid4().hex[:8]}", "dry_run": True}
        data = json.dumps(body).encode() if body is not None else None
        req = request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            raise SystemExit(f"Échec {method} {path} → {e.code} : {detail[:800]}")


def load_params(path):
    with open(path, encoding="utf-8") as f:
        p = json.load(f)
    for key in ("slug", "restaurant", "domain", "render", "vercel"):
        if key not in p:
            raise SystemExit(f"Paramètre manquant : {key}")
    for key in ("name", "email"):
        if key not in p["restaurant"]:
            raise SystemExit(f"Paramètre manquant : restaurant.{key}")
    return p


def env_list(d):
    return [{"key": k, "value": str(v)} for k, v in d.items() if v not in (None, "")]


def wait_for(api, path, key, wanted, timeout=900, every=15):
    """Attend qu'une ressource Render atteigne l'état voulu (`key` == wanted)."""
    if api.dry_run:
        return
    start = time.time()
    while time.time() - start < timeout:
        data = api.call("GET", path)
        value = data.get(key) or (data.get("job") or {}).get(key) or (data.get("deploy") or {}).get(key)
        print(f"    état : {value}")
        if value in wanted:
            return value
        if value in ("failed", "canceled", "build_failed", "update_failed", "deactivated"):
            raise SystemExit(f"Ressource en échec ({value}) : {path}")
        time.sleep(every)
    raise SystemExit(f"Délai dépassé en attendant {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("params", help="fichier JSON de paramètres de l'instance")
    ap.add_argument("--dry-run", action="store_true", help="affiche les appels sans rien créer")
    ap.add_argument("--registry", default=os.path.join(os.path.dirname(__file__), "instances", "registry.json"))
    args = ap.parse_args()
    p = load_params(args.params)
    dry = args.dry_run

    render_key = os.environ.get("RENDER_API_KEY", "")
    vercel_token = os.environ.get("VERCEL_TOKEN", "")
    if not dry and (not render_key or not vercel_token):
        raise SystemExit("RENDER_API_KEY et VERCEL_TOKEN sont requis (ou utilisez --dry-run).")
    render = Api(RENDER_API, render_key, dry)
    vercel = Api(VERCEL_API, vercel_token, dry, {"teamId": os.environ["VERCEL_TEAM_ID"]} if os.environ.get("VERCEL_TEAM_ID") else None)

    slug = p["slug"]
    region = p["render"].get("region", "frankfurt")
    owner_id = p["render"].get("owner_id", "")
    repo = p["render"].get("repo", "https://github.com/Scott-SK2/PickEatGo")
    branch = p["render"].get("branch", "main")
    plan = p["render"].get("plan", "starter")
    frontend_url = f"https://{p['domain']}"
    api_host = p["render"].get("service_name", f"{slug}-api")
    api_url = f"https://{api_host}.onrender.com"
    restaurant_id = p.get("restaurant_id") or str(uuid.uuid4())
    secret_key = secrets.token_urlsafe(48)
    initial_password = p["restaurant"].get("password") or secrets.token_urlsafe(10)
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    print(f"\n=== Instance « {p['restaurant']['name']} » ({slug}) · TENANT_RESTAURANT_ID={restaurant_id}\n")

    # 1. Base Postgres et Key Value (même région, plans minimaux)
    print("1. Postgres")
    db = render.call("POST", "/postgres", {"name": f"{slug}-db", "ownerId": owner_id, "region": region,
                                            "plan": p["render"].get("db_plan", "basic_256mb"), "version": "16"})
    print("2. Key Value")
    kv = render.call("POST", "/key-value", {"name": f"{slug}-kv", "ownerId": owner_id, "region": region,
                                             "plan": p["render"].get("kv_plan", "starter"), "maxmemoryPolicy": "allkeys_lru"})
    db_id, kv_id = db.get("id") or db.get("postgres", {}).get("id"), kv.get("id") or kv.get("keyValue", {}).get("id")
    if not dry:
        wait_for(render, f"/postgres/{db_id}", "status", ("available",))
        wait_for(render, f"/key-value/{kv_id}", "status", ("available",))
        db_url = render.call("GET", f"/postgres/{db_id}/connection-info").get("internalConnectionString", "")
        kv_url = render.call("GET", f"/key-value/{kv_id}/connection-info").get("internalConnectionString", "")
    else:
        db_url, kv_url = "postgresql://(internal)", "redis://(internal)"

    # 3. Service web : dépôt commun, variables d'instance, auto-deploy désactivé le temps de l'amorçage
    shared = p.get("shared", {})
    env_vars = {
        "PYTHON_VERSION": "3.12.7", "DJANGO_SETTINGS_MODULE": "pickeatgo.settings", "ENV": "production", "DEBUG": "False",
        "SECRET_KEY": secret_key, "DATABASE_URL": db_url, "REDIS_URL": kv_url,
        "APP_MODE": "single", "TENANT_RESTAURANT_ID": restaurant_id,
        "TENANT_TIMEZONE": p.get("timezone", "Europe/Brussels"), "POWERED_BY_BADGE": "true" if p.get("powered_by_badge", True) else "false",
        "CORS_ALLOWED_ORIGINS": frontend_url, "FRONTEND_URL": frontend_url, "CSRF_TRUSTED_ORIGINS": frontend_url,
        "CLOUDINARY_CLOUD_NAME": shared.get("cloudinary_cloud_name", ""), "CLOUDINARY_API_KEY": shared.get("cloudinary_api_key", ""),
        "CLOUDINARY_API_SECRET": shared.get("cloudinary_api_secret", ""), "CLOUDINARY_FOLDER": f"pickeatgo-{slug}",
        "EMAIL_HOST": shared.get("email_host", ""), "EMAIL_PORT": shared.get("email_port", "587"),
        "EMAIL_HOST_USER": shared.get("email_host_user", ""), "EMAIL_HOST_PASSWORD": shared.get("email_host_password", ""),
        "DEFAULT_FROM_EMAIL": shared.get("default_from_email", "PickEatGo <no-reply@pickeatgo.app>"),
        "VAPID_ADMIN_EMAIL": shared.get("vapid_admin_email", ""),
        "ADMIN_EMAIL": shared.get("admin_email", ""), "ADMIN_PASSWORD": shared.get("admin_password", ""),
    }
    print("3. Service web")
    svc = render.call("POST", "/services", {
        "type": "web_service", "name": api_host, "ownerId": owner_id, "repo": repo, "branch": branch, "autoDeploy": "no",
        "rootDir": "backend", "envVars": env_list(env_vars),
        "serviceDetails": {
            "env": "python", "region": region, "plan": plan, "healthCheckPath": "/api/v1/health/",
            "envSpecificDetails": {
                "buildCommand": "pip install -r requirements.txt && DATABASE_URL=sqlite:///tmp/build-dummy.db python manage.py collectstatic --noinput",
                "startCommand": "python manage.py migrate --noinput && python manage.py create_admin && uvicorn pickeatgo.asgi:application --host 0.0.0.0 --port $PORT --workers 1 --log-level info --lifespan off",
            },
        },
    })
    svc_id = svc.get("id") or svc.get("service", {}).get("id")

    # 4. Amorçage : job one-off bootstrap_tenant (migrations + compte + restaurant + marque), puis déploiement
    r = p["restaurant"]
    cmd = (f"python manage.py bootstrap_tenant --restaurant-id {restaurant_id} --name {json.dumps(r['name'])} --email {json.dumps(r['email'])} "
           f"--password {json.dumps(initial_password)} --address {json.dumps(r.get('address', ''))} --city {json.dumps(r.get('city', 'Bruxelles'))} "
           f"--phone {json.dumps(r.get('phone', ''))} --first-name {json.dumps(r.get('first_name', ''))} --last-name {json.dumps(r.get('last_name', ''))}"
           + "".join(f" --cuisine {json.dumps(c)}" for c in r.get("cuisine", [])))
    print("4. Amorçage (job bootstrap_tenant)")
    job = render.call("POST", f"/services/{svc_id}/jobs", {"startCommand": cmd})
    if not dry:
        wait_for(render, f"/services/{svc_id}/jobs/{job.get('id')}", "status", ("succeeded",), timeout=1200)
    print("   Déploiement initial")
    dep = render.call("POST", f"/services/{svc_id}/deploys", {"clearCache": "do_not_clear"})
    if not dry:
        wait_for(render, f"/services/{svc_id}/deploys/{dep.get('id')}", "status", ("live",), timeout=1800)
        render.call("PATCH", f"/services/{svc_id}", {"autoDeploy": "yes"})

    # 5. Cron jobs (mêmes variables que le service)
    print("5. Cron jobs")
    crons = {}
    for name, schedule, command in (("stock-digest", "0 7 * * *", "python manage.py stock_digest"), ("weekly-report", "0 8 * * 1", "python manage.py weekly_report")):
        c = render.call("POST", "/services", {
            "type": "cron_job", "name": f"{slug}-{name}", "ownerId": owner_id, "repo": repo, "branch": branch, "rootDir": "backend",
            "envVars": env_list(env_vars),
            "serviceDetails": {"env": "python", "region": region, "plan": "starter", "schedule": schedule,
                               "envSpecificDetails": {"buildCommand": "pip install -r requirements.txt", "startCommand": command}},
        })
        crons[name] = c.get("id") or c.get("service", {}).get("id")

    # 6. Vercel : projet frontend + domaine
    print("6. Vercel")
    repo_path = repo.replace("https://github.com/", "")
    proj = vercel.call("POST", "/v10/projects", {
        "name": p["vercel"].get("project_name", f"{slug}-app"), "framework": "nextjs", "rootDirectory": "frontend",
        "gitRepository": {"type": "github", "repo": repo_path},
        "environmentVariables": [
            {"key": "NEXT_PUBLIC_API_URL", "value": f"{api_url}/api/v1", "target": ["production", "preview"], "type": "plain"},
            {"key": "NEXT_PUBLIC_WS_URL", "value": api_url.replace("https://", "wss://"), "target": ["production", "preview"], "type": "plain"},
        ],
    })
    proj_id = proj.get("id")
    dom = vercel.call("POST", f"/v10/projects/{proj_id}/domains", {"name": p["domain"]})
    print("   Domaine attaché ; enregistrement DNS à communiquer au restaurateur :")
    print(f"     {p['domain']}  CNAME  cname.vercel-dns.com.   (ou A 76.76.21.21 pour un domaine racine)")
    if dom.get("verification"):
        print("     vérification demandée par Vercel : " + json.dumps(dom["verification"], ensure_ascii=False))

    # 7. Registre interne de l'éditeur
    entry = {
        "slug": slug, "name": r["name"], "app_domain": p["domain"], "api_url": api_url, "restaurant_id": restaurant_id,
        "contact": {"name": f"{r.get('first_name', '')} {r.get('last_name', '')}".strip(), "email": r["email"], "phone": r.get("phone", "")},
        "render": {"service": svc_id, "postgres": db_id, "key_value": kv_id, "cron_jobs": crons, "region": region},
        "vercel": {"project": proj_id}, "created_at": created_at, "powered_by_badge": p.get("powered_by_badge", True),
        "timezone": p.get("timezone", "Europe/Brussels"), "dry_run": dry,
    }
    registry = []
    if os.path.exists(args.registry):
        with open(args.registry, encoding="utf-8") as f:
            registry = json.load(f)
    registry.append(entry)
    os.makedirs(os.path.dirname(args.registry), exist_ok=True)
    with open(args.registry, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)

    print("\n=== Terminé ===")
    print(f"Application : {frontend_url}   API : {api_url}   Fiche : {args.registry}")
    print(f"Compte restaurateur : {r['email']}  mot de passe initial : {initial_password}  (à transmettre, puis à changer)")
    print("Reste à faire : générer les clés VAPID dans le shell du service (generate_vapid_keys) et les coller dans les variables ;")
    print("                vérifier le DNS du domaine ; retirer ADMIN_PASSWORD des variables après le premier démarrage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
