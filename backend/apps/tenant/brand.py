"""
tenant/brand.py — Contexte « brand » utilisé par les e-mails, les notifications push,
le manifest et le frontend.

    brand_context() → {
        "mode", "app_name", "short_name", "sender_name", "from_email", "signature",
        "badge" (bool), "badge_text", "icon_url", "frontend_url", "timezone", "restaurant" (ou None)
    }

En mode platform, la marque est celle de PickEatGo. En mode single, celle du restaurant lié
(créée avec des valeurs par défaut si le restaurateur ne l'a pas encore personnalisée).
"""
from email.utils import parseaddr

from django.conf import settings

from .context import get_tenant_restaurant, is_single_mode, powered_by_badge, tenant_timezone

PLATFORM_NAME = "PickEatGo"
BADGE_TEXT = "Application propulsée par PickEatGo"


def _sender_address():
    """Adresse technique de l'éditeur (celle de DEFAULT_FROM_EMAIL), sans le nom d'affichage."""
    _, addr = parseaddr(getattr(settings, "DEFAULT_FROM_EMAIL", "") or "")
    return addr or "no-reply@pickeatgo.app"


def _platform_context():
    return {
        "mode": "platform",
        "app_name": PLATFORM_NAME,
        "short_name": PLATFORM_NAME,
        "sender_name": PLATFORM_NAME,
        "from_email": getattr(settings, "DEFAULT_FROM_EMAIL", f"{PLATFORM_NAME} <{_sender_address()}>"),
        "signature": f"— {PLATFORM_NAME}",
        "badge": False,
        "badge_text": "",
        "icon_url": None,
        "frontend_url": getattr(settings, "FRONTEND_URL", ""),
        "timezone": tenant_timezone(),
        "restaurant": None,
        "branding": None,
    }


def brand_context(restaurant=None):
    """Contexte de marque. `restaurant` permet de forcer le restaurant (tâches planifiées, tests)."""
    if not is_single_mode():
        return _platform_context()
    restaurant = restaurant or get_tenant_restaurant()
    if restaurant is None:
        return _platform_context()
    from .models import Branding
    from apps.menus.serializers import image_url_of
    brand = Branding.for_restaurant(restaurant)
    badge = powered_by_badge()
    sender = brand.effective_sender_name
    signature = f"— {brand.app_name}" + (f"\n{BADGE_TEXT}" if badge else "")
    return {
        "mode": "single",
        "app_name": brand.app_name,
        "short_name": brand.short_name,
        "sender_name": sender,
        "from_email": f"{sender} via {PLATFORM_NAME} <{_sender_address()}>" if badge else f"{sender} <{_sender_address()}>",
        "signature": signature,
        "badge": badge,
        "badge_text": BADGE_TEXT if badge else "",
        "icon_url": image_url_of(brand.icon_192) if brand.icon_192 else None,
        "frontend_url": getattr(settings, "FRONTEND_URL", ""),
        "timezone": tenant_timezone(),
        "restaurant": restaurant,
        "branding": brand,
    }


def subject(text, ctx=None):
    """Objet d'e-mail préfixé du nom de l'application : « [Burger House] Commande #12 enregistrée »."""
    ctx = ctx or brand_context()
    return f"[{ctx['app_name']}] {text}"
