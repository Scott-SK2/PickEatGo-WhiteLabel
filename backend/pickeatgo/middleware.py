"""
pickeatgo/middleware.py
Authentification JWT des WebSockets.

Méthode recommandée : le jeton est envoyé dans le premier message ({"type": "auth", "token": "…"}),
traité par OrderConsumer. Ce middleware conserve la lecture de ?token=… dans l'URL pour les anciennes
versions de l'application ; sans paramètre, l'utilisateur reste anonyme jusqu'au message d'authentification.
"""
import logging
from urllib.parse import parse_qs, unquote

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser

log = logging.getLogger(__name__)


@database_sync_to_async
def get_user_from_token(token_key):
    """Utilisateur porté par un jeton d'accès JWT, ou AnonymousUser si le jeton est invalide ou expiré."""
    try:
        import django
        if not django.apps.apps.ready:
            django.setup()

        from django.contrib.auth import get_user_model
        from rest_framework_simplejwt.tokens import AccessToken

        User = get_user_model()
        token = AccessToken(unquote(token_key))
        return User.objects.get(id=token["user_id"], is_active=True)
    except Exception as e:                       # jeton expiré, falsifié, utilisateur supprimé…
        log.debug("WS : jeton refusé (%s)", e.__class__.__name__)
        return AnonymousUser()


class JWTAuthMiddleware:
    """Middleware ASGI : lit ?token=… si présent, sinon laisse l'utilisateur anonyme."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            params = parse_qs(scope.get("query_string", b"").decode("utf-8"))
            token_list = params.get("token", [])
            scope["user"] = await get_user_from_token(token_list[0]) if token_list else AnonymousUser()
        return await self.inner(scope, receive, send)


def JWTAuthMiddlewareStack(inner):
    return JWTAuthMiddleware(inner)
