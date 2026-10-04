from django.apps import AppConfig


class TenantConfig(AppConfig):
    """Édition Marque Blanche : mode mono-restaurant et marque de l'application."""
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.tenant"
    verbose_name = "Instance (marque blanche)"

    def ready(self):
        from . import checks   # noqa: F401 — enregistre les vérifications de démarrage
        from . import signals  # noqa: F401 — invalidation du cache de la marque
        from .logbuffer import install
        install()                # journal technique récent (fiche d'instance)
