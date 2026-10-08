"""
pickeatgo/settings_prod.py
Overrides de production — chargé automatiquement sur Render
"""
import os
import dj_database_url

# Sécurité
DEBUG = False
if os.environ.get("SECRET_KEY", "") in ("", "dev-secret-change-in-production-!!!!"):
    from django.core.exceptions import ImproperlyConfigured
    raise ImproperlyConfigured("SECRET_KEY doit être définie dans les variables d'environnement de production.")
_allowed = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()]
# Inclure automatiquement le domaine Render
for _h in [
    os.environ.get("RENDER_EXTERNAL_HOSTNAME", ""), # Render (ex: pickeatgo-backend.onrender.com)
    ".onrender.com",
    "localhost",
    "127.0.0.1",
]:
    if _h and _h not in _allowed:
        _allowed.append(_h)
ALLOWED_HOSTS = _allowed

# Base de données PostgreSQL Render (timeout 10s pour éviter les blocages infinis)
_db_config = dj_database_url.config(
    default=os.environ.get("DATABASE_URL", ""),
    conn_max_age=600,
)
_db_config.setdefault("OPTIONS", {})["connect_timeout"] = 10
DATABASES = {"default": _db_config}

# Redis (optionnel — InMemoryChannelLayer si absent)
_PROD_REDIS = os.environ.get("REDIS_URL")

if _PROD_REDIS:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [_PROD_REDIS]},
        }
    }
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": _PROD_REDIS,
            "OPTIONS": {
                "CLIENT_CLASS":    "django_redis.client.DefaultClient",
                "IGNORE_EXCEPTIONS": True,  # Fallback silencieux si Redis indisponible
            },
            "TIMEOUT": 300,
        }
    }
else:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# Middleware production avec WhiteNoise pour les fichiers statiques
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
STATICFILES_STORAGE = "whitenoise.storage.CompressedStaticFilesStorage"

# CORS — frontend Vercel
_cors_prod = os.environ.get("CORS_ALLOWED_ORIGINS", "")
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_prod.split(",") if o.strip()]
CORS_ALLOW_ALL_ORIGINS = os.environ.get("CORS_ALLOW_ALL_ORIGINS", "").lower() in ("true", "1", "yes")
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_METHODS = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]
CORS_ALLOW_HEADERS = [
    "accept", "accept-encoding", "authorization", "content-type",
    "dnt", "origin", "user-agent", "x-csrftoken", "x-requested-with",
]

# SSL via proxy (Render termine le TLS en amont)
SECURE_SSL_REDIRECT = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
_csrf_origins = [o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]
# Ajouter automatiquement l'URL publique Render si disponible
_render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")
if _render_host:
    _render_url = f"https://{_render_host}"
    if _render_url not in _csrf_origins:
        _csrf_origins.append(_render_url)
CSRF_TRUSTED_ORIGINS = _csrf_origins

# Logging — affiche les erreurs Django dans la console (capturé par Render)
# Par défaut en prod Django envoie les 500 par email (ADMINS) et n'affiche rien.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{levelname}] {asctime} {name}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
        # Journal technique récent de la fiche d'instance (console éditeur) : les loggers ci-dessous
        # ne remontent pas à la racine (propagate=False), ils doivent donc l'alimenter directement.
        "memory": {
            "class": "apps.tenant.logbuffer.MemoryLogHandler",
            "level": "WARNING",
        },
    },
    "loggers": {
        # Erreurs de requêtes Django (500, 404, etc.) → traceback complet
        "django.request": {
            "handlers": ["console", "memory"],
            "level": "ERROR",
            "propagate": False,
        },
        # Erreurs de sécurité (ALLOWED_HOSTS, CSRF, etc.)
        "django.security": {
            "handlers": ["console", "memory"],
            "level": "ERROR",
            "propagate": False,
        },
        # Erreurs base de données
        "django.db.backends": {
            "handlers": ["console", "memory"],
            "level": "ERROR",
            "propagate": False,
        },
    },
}
