"""
Vérifications de démarrage du mode mono-restaurant (framework « checks » de Django :
exécutées par `manage.py check`, `migrate`, `runserver` et au démarrage ASGI).

  tenant.E001  APP_MODE invalide
  tenant.E002  TENANT_RESTAURANT_ID renseigné mais aucun restaurant ne porte cet identifiant
  tenant.E003  TENANT_TIMEZONE inconnu
  tenant.W001  APP_MODE=single sans TENANT_RESTAURANT_ID (instance pas encore amorcée : lancez bootstrap_tenant)
"""
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.checks import Error, Warning, register, Tags
from django.db import DatabaseError

from .context import PLATFORM, SINGLE, app_mode, tenant_restaurant_id, tenant_timezone


@register(Tags.compatibility)
def check_tenant_settings(app_configs, **kwargs):
    errors = []
    mode = app_mode()
    if mode not in (PLATFORM, SINGLE):
        errors.append(Error(f"APP_MODE={mode!r} : valeurs acceptées « platform » ou « single ».", id="tenant.E001"))
        return errors
    try:
        ZoneInfo(tenant_timezone())
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        errors.append(Error(f"TENANT_TIMEZONE={tenant_timezone()!r} n'est pas un fuseau horaire IANA valide (ex. Europe/Brussels).", id="tenant.E003"))
    if mode != SINGLE:
        return errors
    rid = tenant_restaurant_id()
    if not rid:
        errors.append(Warning(
            "APP_MODE=single mais TENANT_RESTAURANT_ID est vide : l'instance n'est pas encore liée à un restaurant.",
            hint="Exécutez `python manage.py bootstrap_tenant --name … --email …` puis reportez l'identifiant affiché dans TENANT_RESTAURANT_ID.",
            id="tenant.W001"))
        return errors
    try:
        uuid.UUID(rid)
    except ValueError:
        errors.append(Error(f"TENANT_RESTAURANT_ID={rid!r} n'est pas un UUID.", id="tenant.E002"))
        return errors
    errors.extend(check_tenant_restaurant_exists())
    return errors


def check_tenant_restaurant_exists():
    """Le restaurant lié doit exister en base (sauf si la table n'existe pas encore : première migration)."""
    from apps.restaurants.models import Restaurant
    rid = tenant_restaurant_id()
    try:
        exists = Restaurant.objects.filter(pk=rid).exists()
    except DatabaseError:
        return []           # base pas encore migrée : la vérification se refera au prochain démarrage
    if not exists:
        return [Error(f"Aucun restaurant ne porte l'identifiant TENANT_RESTAURANT_ID={rid}.",
                      hint="Vérifiez la variable d'instance ou relancez bootstrap_tenant.", id="tenant.E002")]
    return []


def verify_tenant_or_fail():
    """
    Appelé au démarrage du serveur ASGI : refuse de servir une instance mono-restaurant
    dont le restaurant lié n'existe pas (les autres vérifications passent par `manage.py check`).
    La requête s'exécute dans un thread dédié : uvicorn importe l'application depuis une boucle
    asynchrone, où Django interdit les accès synchrones à la base.
    """
    import asyncio
    import threading
    from django.core.exceptions import ImproperlyConfigured
    from django.db import connection
    if app_mode() != SINGLE or not tenant_restaurant_id():
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:                # pas de boucle (tests, commandes) : requête directe
        problems = check_tenant_restaurant_exists()
        if problems:
            raise ImproperlyConfigured(" ".join(p.msg for p in problems))
        return
    result = {}

    def run():
        try:
            result["problems"] = check_tenant_restaurant_exists()
        except Exception as e:          # base injoignable : on laisse le serveur démarrer, la vérification se refera
            result["error"] = e
        finally:
            connection.close()

    t = threading.Thread(target=run, name="tenant-check")
    t.start()
    t.join()
    problems = result.get("problems") or []
    if problems:
        raise ImproperlyConfigured(" ".join(p.msg for p in problems))
