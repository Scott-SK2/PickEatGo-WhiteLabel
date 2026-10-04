"""
orders/consumers.py
WebSocket consumer — temps réel des commandes.

Authentification : le client envoie son jeton dans le PREMIER message, {"type": "auth", "token": "..."},
et non dans l'URL (un jeton dans l'URL finit dans les journaux du proxy et du serveur).
Le jeton dans l'URL (?token=) reste accepté pour les anciennes versions installées de l'application.
"""
import asyncio
import json
import logging

from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

log = logging.getLogger(__name__)

AUTH_TIMEOUT = 10   # secondes laissées au client pour s'authentifier après la connexion


class OrderConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.user = None
        self.groups = []
        self._auth_timer = None
        await self.accept()
        user = self.scope.get("user")
        if user is not None and getattr(user, "is_authenticated", False):
            await self._authenticated(user)                      # jeton passé dans l'URL (ancienne méthode)
        else:
            self._auth_timer = asyncio.get_event_loop().call_later(AUTH_TIMEOUT, lambda: asyncio.ensure_future(self._auth_expired()))

    async def _auth_expired(self):
        if self.user is None:
            log.info("WS : aucun jeton reçu en %s s, fermeture", AUTH_TIMEOUT)
            await self.close(code=4001)

    async def _authenticated(self, user):
        """Rejoint les groupes de l'utilisateur et confirme la connexion."""
        self.user = user
        if self._auth_timer:
            self._auth_timer.cancel()
            self._auth_timer = None
        try:
            if getattr(user, "is_restaurateur", False):
                restaurant = await self._get_restaurant(user)
                if restaurant:
                    await self._join(f"restaurant_{restaurant.id}")
            if getattr(user, "is_client", False):
                await self._join(f"client_{user.id}")
            if getattr(user, "is_admin_user", False):
                await self._join("admin_orders")
            await self.send(json.dumps({
                "type":    "connection_established",
                "message": f"Connecté en tant que {user.first_name} {user.last_name}",
                "groups":  self.groups,
            }))
            log.debug("WS : utilisateur %s connecté, groupes %s", user.pk, self.groups)
        except Exception:
            log.exception("WS : erreur lors de l'ouverture de session")
            await self.close()

    async def _join(self, group):
        await self.channel_layer.group_add(group, self.channel_name)
        self.groups.append(group)

    async def disconnect(self, close_code):
        if self._auth_timer:
            self._auth_timer.cancel()
        for group in getattr(self, "groups", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return
        kind = data.get("type")
        if kind == "auth":
            if self.user is not None:
                return                                            # déjà authentifié
            from pickeatgo.middleware import get_user_from_token
            user = await get_user_from_token(str(data.get("token") or ""))
            if not getattr(user, "is_authenticated", False):
                await self.send(json.dumps({"type": "auth_failed"}))
                await self.close(code=4001)
                return
            await self._authenticated(user)
        elif kind == "ping":
            await self.send(json.dumps({"type": "pong"}))

    async def order_event(self, event):
        if self.user is None:
            return
        await self.send(json.dumps({
            "type":  event["event"],
            "order": event["order"],
        }))

    @database_sync_to_async
    def _get_restaurant(self, user):
        try:
            return user.restaurant
        except Exception:
            return None
