"""restaurants/access.py — Contrôle d'accès aux données d'un restaurant."""
from django.core.exceptions import ValidationError
from .models import Restaurant


def get_owned_restaurant(user, restaurant_id):
    """
    Retourne le restaurant si l'utilisateur en est propriétaire (ou admin), sinon None.
    Accepte un id invalide sans lever d'exception.
    """
    if not restaurant_id or not getattr(user, "is_authenticated", False):
        return None
    from apps.tenant.context import is_tenant_restaurant
    if not is_tenant_restaurant(restaurant_id):          # mode mono-restaurant : seul le restaurant lié existe
        return None
    try:
        restaurant = Restaurant.objects.select_related("owner").get(pk=restaurant_id)
    except (Restaurant.DoesNotExist, ValueError, ValidationError):
        return None
    if restaurant.owner_id == user.id or getattr(user, "is_admin_user", False):
        return restaurant
    return None
