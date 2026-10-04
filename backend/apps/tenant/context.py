"""
tenant/context.py — Mode de l'instance et restaurant lié.

PickEatGo et l'édition Marque Blanche sont le même logiciel, dans deux modes :
  - « platform » (défaut) : place de marché multi-restaurants, comportement historique ;
  - « single »            : l'instance entière est liée à UN restaurant (TENANT_RESTAURANT_ID).

Toutes les vues passent par ces fonctions pour savoir si elles doivent se limiter au
restaurant lié. En mode platform, elles ne changent rien.
"""
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError

SINGLE = "single"
PLATFORM = "platform"
BRANDING_CACHE_KEY = "branding:v1"


def app_mode():
    return getattr(settings, "APP_MODE", PLATFORM)


def is_single_mode():
    return app_mode() == SINGLE


def tenant_restaurant_id():
    """UUID du restaurant lié (chaîne) en mode single, sinon None."""
    if not is_single_mode():
        return None
    raw = getattr(settings, "TENANT_RESTAURANT_ID", None)
    return str(raw) if raw else None


def tenant_timezone():
    return getattr(settings, "TENANT_TIMEZONE", None) or getattr(settings, "TIME_ZONE", "Europe/Brussels")


def powered_by_badge():
    return bool(getattr(settings, "POWERED_BY_BADGE", True))


def get_tenant_restaurant(select_related=None, prefetch_related=None):
    """Restaurant lié à l'instance, ou None (mode platform, identifiant absent ou introuvable)."""
    rid = tenant_restaurant_id()
    if not rid:
        return None
    from apps.restaurants.models import Restaurant
    qs = Restaurant.objects.all()
    if select_related:
        qs = qs.select_related(*select_related)
    if prefetch_related:
        qs = qs.prefetch_related(*prefetch_related)
    try:
        return qs.get(pk=rid)
    except (Restaurant.DoesNotExist, ValueError, ValidationError):
        return None


def is_tenant_restaurant(restaurant_or_id):
    """Vrai si l'objet (ou l'identifiant) désigne le restaurant lié. Toujours vrai en mode platform."""
    if not is_single_mode():
        return True
    rid = tenant_restaurant_id()
    if not rid:
        return False
    value = getattr(restaurant_or_id, "pk", restaurant_or_id)
    return str(value) == rid


def scope_restaurants(qs):
    """Jeu de restaurants limité au restaurant lié en mode single (vide si l'instance n'est pas configurée)."""
    if not is_single_mode():
        return qs
    rid = tenant_restaurant_id()
    if not rid:
        return qs.none()
    try:
        uuid.UUID(rid)
    except ValueError:
        return qs.none()
    return qs.filter(pk=rid)


def scope_by_restaurant(qs, field="restaurant"):
    """Limite n'importe quel jeu de données au restaurant lié via le champ donné (ex. « category__restaurant »)."""
    if not is_single_mode():
        return qs
    rid = tenant_restaurant_id()
    if not rid:
        return qs.none()
    try:
        uuid.UUID(rid)
    except ValueError:
        return qs.none()
    return qs.filter(**{f"{field}_id" if "__" not in field else field: rid})


def single_mode_denied(message="Indisponible en mode mono-restaurant."):
    from rest_framework.response import Response
    return Response({"detail": message}, status=403)
