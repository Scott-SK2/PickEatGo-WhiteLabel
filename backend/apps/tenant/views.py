"""
tenant/views.py — Points d'entrée de l'édition Marque Blanche.

  GET   /api/v1/branding/            public      mode, fuseau, restaurant lié, marque, état de publication (cache 60 s)
  PATCH /api/v1/branding/            O / A       modification des champs de marque
  POST  /api/v1/branding/icons/      O / A       icônes 192 / 512 / maskable (envoi ou génération depuis le logo), image de partage
  GET   /api/v1/branding/instance/   A           fiche technique de l'instance (console éditeur)
"""
import os
import uuid
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.utils import timezone
from rest_framework import parsers, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.menus.views import cloudinary_upload, cloudinary_destroy, validate_image_file
from apps.restaurants.serializers import RestaurantDetailSerializer

from . import logbuffer
from .brand import PLATFORM_NAME
from .context import BRANDING_CACHE_KEY, app_mode, get_tenant_restaurant, is_single_mode, powered_by_badge, tenant_timezone
from .icons import build_icons, normalize_share_image
from .models import Branding, DEFAULT_THEME_COLOR, DEFAULT_BACKGROUND_COLOR
from .serializers import BrandingSerializer, BrandingIconsSerializer

STARTED_AT = datetime.now(dt_timezone.utc)
CACHE_SECONDS = 60


def _platform_brand():
    return {
        "app_name": PLATFORM_NAME, "short_name": PLATFORM_NAME,
        "tagline": "Commander. Récupérer. C'est tout.",
        "welcome_text": "Précommandez chez vos restaurants préférés et récupérez votre repas prêt à l'heure choisie.",
        "icon_192_url": None, "icon_512_url": None, "icon_maskable_url": None, "share_image_url": None,
        "theme_color": DEFAULT_THEME_COLOR, "social_links": {},
        "legal_name": "", "company_number": "", "vat_number": "", "legal_address": "", "publisher": "",
        "terms_text": "", "privacy_text": "", "sender_name": PLATFORM_NAME, "effective_sender_name": PLATFORM_NAME,
        "legal_complete": True, "missing_legal_fields": [], "updated_at": None,
    }


def publication_state(restaurant, brand):
    """Récapitulatif de mise en ligne : ce qui manque est listé (carte « Mon application »)."""
    from apps.menus.models import MenuItem
    frontend = (getattr(settings, "FRONTEND_URL", "") or "").strip()
    checks = [
        ("domain", "Domaine public configuré", bool(frontend) and "localhost" not in frontend and "127.0.0.1" not in frontend),
        ("legal", "Mentions légales, conditions et confidentialité renseignées", brand.legal_complete and bool(brand.terms_text) and bool(brand.privacy_text)),
        ("hours", "Horaires d'ouverture définis", restaurant.hours.exists()),
        ("menu", "Au moins un plat disponible", MenuItem.objects.filter(category__restaurant=restaurant, is_available=True).exists()),
        ("switch", "Interrupteur sur « ouvert »", bool(restaurant.is_open)),
        ("icons", "Icônes d'installation", bool(brand.icon_192 and brand.icon_512 and brand.icon_maskable)),
    ]
    items = [{"key": k, "label": label, "ok": bool(ok)} for k, label, ok in checks]
    return {"ready": all(i["ok"] for i in items), "items": items, "missing": [i["label"] for i in items if not i["ok"]],
            "public_url": frontend}


def build_branding_payload(request=None):
    """Corps de GET /branding/ (sans cache)."""
    base = {
        "mode": app_mode(),
        "timezone": tenant_timezone(),
        "powered_by_badge": powered_by_badge() if is_single_mode() else False,
        "theme_color": DEFAULT_THEME_COLOR,
        "background_color": DEFAULT_BACKGROUND_COLOR,
        "platform_name": PLATFORM_NAME,
    }
    if not is_single_mode():
        return {**base, "configured": True, "restaurant": None, "brand": _platform_brand(), "publication": None}
    restaurant = get_tenant_restaurant(select_related=("owner",), prefetch_related=("hours", "gallery", "categories__items__options", "categories__items__photos"))
    if restaurant is None:
        return {**base, "configured": False, "restaurant": None, "brand": _platform_brand(), "publication": None,
                "detail": "Instance non configurée : TENANT_RESTAURANT_ID absent ou introuvable."}
    brand = Branding.for_restaurant(restaurant)
    ctx = {"request": request}
    rest_data = RestaurantDetailSerializer(restaurant, context=ctx).data     # contexte anonyme : champs privés omis
    for private in ("owner_email", "contract_model", "commission_pct", "monthly_fee", "featured_fee", "admin_manages_menu",
                    "contract_notes", "contract_paid", "invoicing_day", "monthly_due", "total_revenue"):
        rest_data.pop(private, None)
    rest_data["status"] = "active"
    return {**base, "configured": True, "restaurant": rest_data, "brand": BrandingSerializer(brand, context=ctx).data,
            "publication": publication_state(restaurant, brand)}


class BrandingView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [parsers.JSONParser, parsers.FormParser, parsers.MultiPartParser]

    def get(self, request):
        payload = None
        try:
            payload = cache.get(BRANDING_CACHE_KEY)
        except Exception:
            payload = None
        if payload is None:
            payload = build_branding_payload(request)
            try:
                cache.set(BRANDING_CACHE_KEY, payload, CACHE_SECONDS)
            except Exception:
                pass
        resp = Response(payload)
        resp["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"
        return resp

    def _owned_restaurant(self, request):
        """Restaurant lié si l'appelant en est propriétaire ou éditeur, sinon (None, réponse d'erreur)."""
        if not request.user.is_authenticated:
            return None, Response({"detail": "Authentification requise."}, status=status.HTTP_401_UNAUTHORIZED)
        if not is_single_mode():
            return None, Response({"detail": "La marque de l'application n'existe qu'en mode mono-restaurant."}, status=status.HTTP_404_NOT_FOUND)
        restaurant = get_tenant_restaurant(select_related=("owner",))
        if restaurant is None:
            return None, Response({"detail": "Instance non configurée."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if restaurant.owner_id != request.user.id and not request.user.is_admin_user:
            return None, Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)
        return restaurant, None

    def patch(self, request):
        restaurant, err = self._owned_restaurant(request)
        if err:
            return err
        brand = Branding.for_restaurant(restaurant)
        ser = BrandingSerializer(brand, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        cache.delete(BRANDING_CACHE_KEY)
        return Response(build_branding_payload(request))


class BrandingIconsView(BrandingView):
    """POST multipart : `image` (+ `kind=icons|share`), ou `source=logo` pour générer depuis le logo du restaurant."""
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]

    def get(self, request):
        return Response({"detail": "Méthode non autorisée."}, status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def patch(self, request):
        return Response({"detail": "Méthode non autorisée."}, status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def _logo_bytes(self, restaurant):
        if not restaurant.logo:
            return None
        from apps.menus.serializers import image_url_of
        url = image_url_of(restaurant.logo)
        if url and url.startswith("https://"):
            try:
                from urllib.request import urlopen
                with urlopen(url, timeout=10) as r:
                    return r.read()
            except Exception:
                return None
        try:
            with restaurant.logo.open("rb") as f:
                return f.read()
        except Exception:
            return None

    def _store(self, restaurant, brand, field, data, ext="png"):
        """Enregistre un binaire sur Cloudinary (identifiant unique) ou en local, et retire l'ancien fichier."""
        old = getattr(brand, field).name if getattr(brand, field) else None
        name = f"{field.replace('_', '-')}-{uuid.uuid4().hex[:8]}"
        public_id = cloudinary_upload(ContentFile(data, name=f"{name}.{ext}"), f"branding/{restaurant.id}", name)
        if public_id:
            setattr(brand, field, public_id)
        else:
            getattr(brand, field).save(f"{name}.{ext}", ContentFile(data), save=False)
        if old and old != getattr(brand, field).name:
            cloudinary_destroy(old)
            try:
                from django.core.files.storage import default_storage
                if default_storage.exists(old):
                    default_storage.delete(old)
            except Exception:
                pass

    def post(self, request):
        restaurant, err = self._owned_restaurant(request)
        if err:
            return err
        params = BrandingIconsSerializer(data={k: v for k, v in request.data.items() if k in ("kind", "source")})
        params.is_valid(raise_exception=True)
        kind, source = params.validated_data["kind"], params.validated_data["source"]
        brand = Branding.for_restaurant(restaurant)

        if source == "logo" and kind == "icons":
            raw = self._logo_bytes(restaurant)
            if not raw:
                return Response({"detail": "Aucun logo à utiliser : ajoutez d'abord un logo dans Paramètres, ou envoyez une image."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            file, ferr = validate_image_file(request)
            if ferr:
                return ferr
            raw = file.read()
        try:
            if kind == "share":
                self._store(restaurant, brand, "share_image", normalize_share_image(raw), ext="jpg")
            else:
                icons = build_icons(raw, bg=brand.theme_color or DEFAULT_THEME_COLOR)
                for field, data in icons.items():
                    self._store(restaurant, brand, field, data)
        except Exception as e:      # image illisible, corrompue…
            return Response({"detail": f"Image illisible : {e.__class__.__name__}."}, status=status.HTTP_400_BAD_REQUEST)
        brand.save()
        cache.delete(BRANDING_CACHE_KEY)
        return Response(build_branding_payload(request), status=status.HTTP_200_OK)


class InstanceInfoView(APIView):
    """GET /api/v1/branding/instance/ — fiche technique de l'instance, réservée à l'éditeur (rôle administration)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not request.user.is_admin_user:
            return Response({"detail": "Accès réservé à l'éditeur."}, status=status.HTTP_403_FORBIDDEN)
        restaurant = get_tenant_restaurant(select_related=("owner",)) if is_single_mode() else None
        brand = Branding.for_restaurant(restaurant) if restaurant else None
        env = os.environ
        db = settings.DATABASES.get("default", {})
        from apps.orders.models import Order
        from apps.accounts.models import User
        orders = Order.objects.exclude(status=Order.CANCELLED)
        if restaurant:
            orders = orders.filter(restaurant=restaurant)
        revenue = sum((o.total_price for o in orders.filter(status=Order.PICKED_UP).only("total_price")), 0)
        last_order = orders.order_by("-created_at").values_list("created_at", flat=True).first()
        return Response({
            "mode": app_mode(),
            "timezone": tenant_timezone(),
            "powered_by_badge": powered_by_badge(),
            "licensee": {
                "restaurant_id": str(restaurant.id) if restaurant else None,
                "restaurant_name": restaurant.name if restaurant else None,
                "owner_name": restaurant.owner.full_name if restaurant else None,
                "owner_email": restaurant.owner.email if restaurant else None,
                "app_name": brand.app_name if brand else PLATFORM_NAME,
                "since": (brand.created_at if brand else restaurant.created_at) if restaurant else None,
            },
            "domain": {
                "frontend_url": getattr(settings, "FRONTEND_URL", ""),
                "api_url": env.get("RENDER_EXTERNAL_URL") or request.build_absolute_uri("/").rstrip("/"),
                "cors_origins": list(getattr(settings, "CORS_ALLOWED_ORIGINS", [])),
            },
            "version": {
                "commit": env.get("RENDER_GIT_COMMIT") or env.get("GIT_COMMIT") or env.get("SOURCE_VERSION") or "",
                "branch": env.get("RENDER_GIT_BRANCH") or env.get("GIT_BRANCH") or "",
                "service": env.get("RENDER_SERVICE_NAME") or "",
                "started_at": STARTED_AT,
                "env": getattr(settings, "ENV", ""),
                "debug": bool(getattr(settings, "DEBUG", False)),
            },
            "services": {
                "database": db.get("ENGINE", "").rsplit(".", 1)[-1],
                "redis": bool(env.get("REDIS_URL")),
                "cloudinary": bool(settings.CLOUDINARY_STORAGE.get("CLOUD_NAME")),
                "cloudinary_folder": settings.CLOUDINARY_STORAGE.get("PREFIX"),
                "smtp": bool(getattr(settings, "EMAIL_HOST", "")),
                "email_from": getattr(settings, "DEFAULT_FROM_EMAIL", ""),
                "push": bool(getattr(settings, "VAPID_PUBLIC_KEY", "") and getattr(settings, "VAPID_PRIVATE_KEY", "")),
                "push_contact": getattr(settings, "VAPID_ADMIN_EMAIL", ""),
            },
            "activity": {
                "orders": orders.count(),
                "revenue": str(revenue),
                "clients": User.objects.filter(role=User.CLIENT).count(),
                "active_clients_30d": orders.filter(created_at__gte=timezone.now() - timezone.timedelta(days=30), client__isnull=False).values("client").distinct().count(),
                "last_order_at": last_order,
            },
            "log": logbuffer.recent(50),
        })
