"""tenant/serializers.py — Marque de l'application (lecture publique, écriture propriétaire / éditeur)."""
import re

from django.core.validators import URLValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.menus.serializers import image_url_of

from .models import Branding, SOCIAL_KEYS, DEFAULT_THEME_COLOR

_url_validator = URLValidator(schemes=["http", "https"])
_COMPANY_RE = re.compile(r"^[0-9A-Za-z .\-]{4,40}$")


class BrandingSerializer(serializers.ModelSerializer):
    icon_192_url      = serializers.SerializerMethodField()
    icon_512_url      = serializers.SerializerMethodField()
    icon_maskable_url = serializers.SerializerMethodField()
    share_image_url   = serializers.SerializerMethodField()
    legal_complete    = serializers.ReadOnlyField()
    missing_legal_fields = serializers.ReadOnlyField()
    effective_sender_name = serializers.ReadOnlyField()

    class Meta:
        model  = Branding
        fields = [
            "app_name", "short_name", "tagline", "welcome_text",
            "icon_192_url", "icon_512_url", "icon_maskable_url", "share_image_url", "theme_color",
            "social_links",
            "legal_name", "company_number", "vat_number", "legal_address", "publisher",
            "terms_text", "privacy_text",
            "sender_name", "effective_sender_name",
            "legal_complete", "missing_legal_fields", "updated_at",
        ]
        read_only_fields = ["theme_color", "updated_at"]
        extra_kwargs = {
            "app_name":   {"max_length": 40, "allow_blank": False, "trim_whitespace": True},
            "short_name": {"max_length": 12, "allow_blank": False, "trim_whitespace": True},
            "tagline":    {"max_length": 120, "allow_blank": True},
            "welcome_text": {"max_length": 300, "allow_blank": True},
            "terms_text": {"max_length": 20000, "allow_blank": True},
            "privacy_text": {"max_length": 20000, "allow_blank": True},
        }

    def _url(self, field):
        return image_url_of(field, self.context.get("request")) if field else None

    def get_icon_192_url(self, obj):      return self._url(obj.icon_192)
    def get_icon_512_url(self, obj):      return self._url(obj.icon_512)
    def get_icon_maskable_url(self, obj): return self._url(obj.icon_maskable)
    def get_share_image_url(self, obj):   return self._url(obj.share_image)

    def validate_social_links(self, value):
        """{"facebook": url, "instagram": url, "tiktok": url, "website": url} — URL http(s) valides, clés connues, vides retirées."""
        if not isinstance(value, dict):
            raise serializers.ValidationError("Format attendu : un objet {réseau: url}.")
        cleaned = {}
        for key, url in value.items():
            if key not in SOCIAL_KEYS:
                raise serializers.ValidationError(f"Réseau inconnu : {key}. Attendu : {', '.join(SOCIAL_KEYS)}.")
            url = str(url or "").strip()
            if not url:
                continue
            if not url.lower().startswith(("http://", "https://")):
                url = "https://" + url
            try:
                _url_validator(url)
            except DjangoValidationError:
                raise serializers.ValidationError(f"Lien {key} invalide : {url}")
            cleaned[key] = url[:300]
        return cleaned

    def validate_company_number(self, value):
        value = (value or "").strip()
        if value and not _COMPANY_RE.match(value):
            raise serializers.ValidationError("Numéro d'entreprise invalide (ex. 0123.456.789).")
        return value

    def validate_theme_color(self, value):
        return DEFAULT_THEME_COLOR     # fixé à l'orange PickEatGo dans cette version


class BrandingIconsSerializer(serializers.Serializer):
    """POST /branding/icons/ : image carrée (ou génération depuis le logo), ou image de partage."""
    kind = serializers.ChoiceField(choices=["icons", "share"], default="icons")
    image = serializers.ImageField(required=False)
    source = serializers.ChoiceField(choices=["upload", "logo"], default="upload")
