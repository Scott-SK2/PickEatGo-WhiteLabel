"""
PickEatGo – Django Settings
Environnements : development / production (via ENV=production)
"""
import os
import dj_database_url
from pathlib import Path
from datetime import timedelta
import environ

BASE_DIR = Path(__file__).resolve().parent.parent
env = environ.Env(DEBUG=(bool, False))
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    environ.Env.read_env(_env_file)

SECRET_KEY  = env("SECRET_KEY", default="dev-secret-change-in-production-!!!!")
DEBUG       = env.bool("DEBUG", default=False)      # env.bool : "False" dans .env doit bien désactiver le debug
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost","127.0.0.1"])
ENV         = env("ENV", default="development")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "channels",
    "cloudinary",
    "cloudinary_storage",
    "django_filters",
    "drf_spectacular",
    # Internal apps
    "apps.accounts",
    "apps.restaurants",
    "apps.menus",
    "apps.orders",
    "apps.notifications",
    "apps.tenant",          # édition Marque Blanche : mode mono-restaurant, marque de l'application
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF     = "pickeatgo.urls"
WSGI_APPLICATION = "pickeatgo.wsgi.application"
ASGI_APPLICATION = "pickeatgo.asgi.application"

_DATABASE_URL = os.environ.get("DATABASE_URL")
if _DATABASE_URL:
    DATABASES = {"default": dj_database_url.config(default=_DATABASE_URL, conn_max_age=600)}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ.get("DB_NAME", "pickeatgo_db"),
            "USER": os.environ.get("DB_USER", "pickeatgo"),
            "PASSWORD": os.environ.get("DB_PASSWORD", "pickeatgo"),
            "HOST": os.environ.get("DB_HOST", "127.0.0.1"),
            "PORT": os.environ.get("DB_PORT", "5432"),
        }
    }

AUTH_USER_MODEL = "accounts.User"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "100/hour", "user": "1000/hour", "password_reset": "5/hour", "pin_unlock": "30/min"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":    timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME":   timedelta(days=7),
    "ROTATE_REFRESH_TOKENS":    True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES":        ("Bearer",),
}

# Parsing manuel pour éviter les bugs de django-environ avec les URLs
# (guillemets accidentels, espaces, etc.)
_cors_raw = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,https://pick-eat-go.vercel.app"
)
CORS_ALLOWED_ORIGINS = [
    o.strip().strip("\"'")
    for o in _cors_raw.split(",")
    if o.strip().strip("\"'")
]
# Mettre CORS_ALLOW_ALL_ORIGINS=True dans Render pour désactiver la whitelist (debug)
CORS_ALLOW_ALL_ORIGINS = os.environ.get("CORS_ALLOW_ALL_ORIGINS", "").lower() in ("true", "1", "yes")
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_METHODS = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]
CORS_ALLOW_HEADERS = [
    "accept", "accept-encoding", "authorization", "content-type",
    "dnt", "origin", "user-agent", "x-csrftoken", "x-requested-with",
]

_REDIS_URL = env("REDIS_URL", default=None)

if _REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG":  {"hosts": [_REDIS_URL]},
        }
    }
    CACHES = {
        "default": {
            "BACKEND":  "django_redis.cache.RedisCache",
            "LOCATION": _REDIS_URL,
            "OPTIONS":  {
                "CLIENT_CLASS":    "django_redis.client.DefaultClient",
                "IGNORE_EXCEPTIONS": True,  # Fallback silencieux si Redis indisponible
            },
            "TIMEOUT":  300,
        }
    }
else:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

CLOUDINARY_STORAGE = {
    "CLOUD_NAME": env("CLOUDINARY_CLOUD_NAME", default=""),
    "API_KEY":    env("CLOUDINARY_API_KEY",    default=""),
    "API_SECRET": env("CLOUDINARY_API_SECRET", default=""),
    "MEDIA_TAG":  "pickeatgo",
    "PREFIX":     env("CLOUDINARY_FOLDER", default="pickeatgo"),
}
_cloudinary_ok = all([
    CLOUDINARY_STORAGE["CLOUD_NAME"],
    CLOUDINARY_STORAGE["API_KEY"],
    CLOUDINARY_STORAGE["API_SECRET"],
])
if _cloudinary_ok:
    # Configure explicitement le SDK cloudinary (django-cloudinary-storage ne
    # garantit pas de le faire assez tôt, ce qui peut causer des uploads silencieux
    # vers le filesystem local au lieu de Cloudinary).
    import cloudinary
    cloudinary.config(
        cloud_name=CLOUDINARY_STORAGE["CLOUD_NAME"],
        api_key=CLOUDINARY_STORAGE["API_KEY"],
        api_secret=CLOUDINARY_STORAGE["API_SECRET"],
        secure=True,          # URLs toujours en https://
    )
    DEFAULT_FILE_STORAGE = "cloudinary_storage.storage.MediaCloudinaryStorage"
else:
    DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"
MEDIA_URL  = "/media/"
MEDIA_ROOT = BASE_DIR / "media"   # uploads locaux (sans Cloudinary) — dossier ignoré par git

# ── E-mail (récapitulatif stocks, notifications) ──────────────────────────────
# Sans EMAIL_HOST, les e-mails sont affichés dans la console (développement).
EMAIL_HOST          = env("EMAIL_HOST", default="")
EMAIL_BACKEND       = env("EMAIL_BACKEND", default=(
    "django.core.mail.backends.smtp.EmailBackend" if EMAIL_HOST else "django.core.mail.backends.console.EmailBackend"))
EMAIL_PORT          = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER     = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS       = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL  = env("DEFAULT_FROM_EMAIL", default="PickEatGo <no-reply@pickeatgo.app>")

# URL publique du frontend (liens dans les e-mails : réinitialisation de mot de passe…)
FRONTEND_URL = env("FRONTEND_URL", default=(CORS_ALLOWED_ORIGINS[0] if CORS_ALLOWED_ORIGINS else "http://localhost:3000"))
EMAIL_SYNC   = env.bool("EMAIL_SYNC", default=False)   # True : envoi immédiat (tests)

# ── Notifications push (Web Push / VAPID) ─────────────────────────────────────
# Clés générées par `python manage.py generate_vapid_keys`. Sans clés, le push est désactivé.
VAPID_PUBLIC_KEY  = env("VAPID_PUBLIC_KEY",  default="")
VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY", default="")
VAPID_ADMIN_EMAIL = env("VAPID_ADMIN_EMAIL", default="contact@pickeatgo.app")
STATIC_URL  = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.debug",
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

# ── Édition Marque Blanche : réglages d'instance ──────────────────────────────
# APP_MODE=platform (défaut) : place de marché multi-restaurants (comportement historique).
# APP_MODE=single : l'instance entière est liée au restaurant TENANT_RESTAURANT_ID
# (créé par `python manage.py bootstrap_tenant`). Voir docs/11-marque-blanche.md.
APP_MODE             = env("APP_MODE", default="platform").strip().lower() or "platform"
TENANT_RESTAURANT_ID = env("TENANT_RESTAURANT_ID", default="").strip() or None
TENANT_TIMEZONE      = env("TENANT_TIMEZONE", default="Europe/Brussels").strip() or "Europe/Brussels"
POWERED_BY_BADGE     = env.bool("POWERED_BY_BADGE", default=True)   # mention « propulsé par PickEatGo »

LANGUAGE_CODE = "fr-be"
TIME_ZONE     = TENANT_TIMEZONE      # fuseau de référence de toutes les règles horaires (horaires, créneaux, rapports)
USE_I18N = USE_TZ = True

# Journal technique récent (fiche d'instance de la console éditeur) : derniers avertissements en mémoire
from apps.tenant.logbuffer import install as _install_log_buffer  # noqa: E402
_install_log_buffer()

CELERY_BROKER_URL     = _REDIS_URL or "memory://"
CELERY_RESULT_BACKEND = _REDIS_URL or "cache+memory://"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_TASK_ALWAYS_EAGER = not bool(_REDIS_URL)  # Exécution synchrone si pas de Redis

SPECTACULAR_SETTINGS = {
    "TITLE":       "PickEatGo API",
    "DESCRIPTION": "API REST pour la plateforme de précommande restaurant PickEatGo",
    "VERSION":     "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

if ENV == "production":
    SECURE_SSL_REDIRECT = False  # Render gère le SSL en amont (proxy)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Charge les overrides de production (Render, ou toute DB PostgreSQL)
if (
    os.environ.get("RENDER")                # Render injecte RENDER=true automatiquement
    or os.environ.get("DATABASE_URL", "").startswith("postgresql")
    or os.environ.get("DATABASE_URL", "").startswith("postgres://")
):
    from .settings_prod import *  # noqa: F401, F403
