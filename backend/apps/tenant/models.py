"""
tenant/models.py — Marque de l'application (édition Marque Blanche).

Un enregistrement par instance, lié au restaurant. Modifiable par le restaurateur depuis
« Paramètres → Mon application », exposé publiquement par GET /api/v1/branding/.
L'identité visuelle (couleurs, typographies) reste celle de PickEatGo dans cette version :
theme_color est fixé à l'orange PickEatGo.
"""
from django.db import models

DEFAULT_THEME_COLOR = "#FF6B2C"
DEFAULT_BACKGROUND_COLOR = "#F8F9FB"

SOCIAL_KEYS = ("facebook", "instagram", "tiktok", "website")


def branding_upload_path(instance, filename):
    return f"branding/{instance.restaurant_id}/{filename}"


class Branding(models.Model):
    restaurant   = models.OneToOneField("restaurants.Restaurant", on_delete=models.CASCADE, related_name="branding")

    # Identité
    app_name     = models.CharField(max_length=40, help_text="Nom affiché partout : barre du haut, onglet, installation, e-mails, tickets")
    short_name   = models.CharField(max_length=12, help_text="Nom sous l'icône de l'écran d'accueil")
    tagline      = models.CharField(max_length=120, blank=True, help_text="Phrase d'accroche de l'accueil")
    welcome_text = models.CharField(max_length=300, blank=True, help_text="Paragraphe sous le slogan")

    # Icônes d'installation et image de partage
    icon_192      = models.ImageField(upload_to=branding_upload_path, blank=True, null=True)
    icon_512      = models.ImageField(upload_to=branding_upload_path, blank=True, null=True)
    icon_maskable = models.ImageField(upload_to=branding_upload_path, blank=True, null=True)
    share_image   = models.ImageField(upload_to=branding_upload_path, blank=True, null=True, help_text="1200 × 630 px conseillé")
    theme_color   = models.CharField(max_length=7, default=DEFAULT_THEME_COLOR)

    # Réseaux sociaux : {"facebook": url, "instagram": url, "tiktok": url, "website": url}
    social_links = models.JSONField(default=dict, blank=True)

    # Mentions légales (obligatoires avant mise en ligne)
    legal_name     = models.CharField(max_length=120, blank=True, help_text="Raison sociale")
    company_number = models.CharField(max_length=40, blank=True, help_text="Numéro d'entreprise")
    vat_number     = models.CharField(max_length=30, blank=True)
    legal_address  = models.CharField(max_length=255, blank=True, help_text="Adresse du siège")
    publisher      = models.CharField(max_length=120, blank=True, help_text="Responsable de publication")

    # Textes (modèles fournis par l'éditeur, complétés par le restaurateur)
    terms_text   = models.TextField(blank=True, help_text="Conditions de commande")
    privacy_text = models.TextField(blank=True, help_text="Politique de confidentialité")

    # E-mails : nom d'expéditeur (l'adresse technique reste celle de l'éditeur)
    sender_name  = models.CharField(max_length=60, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "branding"
        verbose_name = "Marque de l'application"

    def __str__(self):
        return f"Marque « {self.app_name} » ({self.restaurant_id})"

    # ── Valeurs par défaut dérivées du restaurant ─────────────────────────────
    @staticmethod
    def default_short_name(name):
        name = (name or "").strip()
        return name[:12].rstrip() if name else "App"

    @classmethod
    def defaults_for(cls, restaurant):
        return {
            "app_name":   (restaurant.name or "")[:40] or "Mon restaurant",
            "short_name": cls.default_short_name(restaurant.name),
            "vat_number": restaurant.vat_number or "",
            "legal_address": restaurant.address or "",
            "sender_name": (restaurant.name or "")[:60],
        }

    @classmethod
    def for_restaurant(cls, restaurant, create=True):
        """Marque du restaurant, créée avec les valeurs par défaut si elle n'existe pas encore."""
        try:
            return restaurant.branding
        except cls.DoesNotExist:
            if not create:
                return None
            obj, _ = cls.objects.get_or_create(restaurant=restaurant, defaults=cls.defaults_for(restaurant))
            return obj

    @property
    def effective_sender_name(self):
        return self.sender_name or self.app_name

    @property
    def legal_complete(self):
        return all([self.legal_name, self.company_number, self.legal_address, self.publisher])

    @property
    def missing_legal_fields(self):
        labels = {"legal_name": "raison sociale", "company_number": "numéro d'entreprise",
                  "legal_address": "adresse du siège", "publisher": "responsable de publication",
                  "terms_text": "conditions de commande", "privacy_text": "politique de confidentialité"}
        return [label for field, label in labels.items() if not getattr(self, field)]
