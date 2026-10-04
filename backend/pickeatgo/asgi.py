"""
ASGI config – PickEatGo
Gère HTTP classique + WebSockets (Django Channels + JWT auth)
"""
import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pickeatgo.settings")

# Django doit être configuré AVANT tout import d'apps
django.setup()

# Édition Marque Blanche : une instance mono-restaurant dont le restaurant lié n'existe pas refuse de démarrer
from apps.tenant.checks import verify_tenant_or_fail  # noqa: E402
verify_tenant_or_fail()

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from apps.orders.routing import websocket_urlpatterns
from pickeatgo.middleware import JWTAuthMiddlewareStack

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": JWTAuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})
