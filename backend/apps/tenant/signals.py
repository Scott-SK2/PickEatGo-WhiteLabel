"""Invalidation du cache de GET /branding/ dès que la marque, le restaurant ou ses horaires changent."""
from django.core.cache import cache
from django.db.models.signals import post_delete, post_save

from apps.restaurants.models import BusinessHours, Restaurant, RestaurantPhoto

from .context import BRANDING_CACHE_KEY
from .models import Branding


def invalidate_branding_cache(*args, **kwargs):
    try:
        cache.delete(BRANDING_CACHE_KEY)
    except Exception:
        pass


for _model in (Branding, Restaurant, BusinessHours, RestaurantPhoto):
    post_save.connect(invalidate_branding_cache, sender=_model, weak=False, dispatch_uid=f"branding-cache-save-{_model.__name__}")
    post_delete.connect(invalidate_branding_cache, sender=_model, weak=False, dispatch_uid=f"branding-cache-delete-{_model.__name__}")
