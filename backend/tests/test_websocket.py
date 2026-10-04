"""WebSocket temps réel : authentification par premier message, refus sans jeton, groupes rejoints."""
import json

import pytest
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from pickeatgo.asgi import application


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def in_memory_channel_layer(settings):
    """Les tests n'ont pas de Redis : couche de canaux en mémoire."""
    from channels.layers import channel_layers
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    channel_layers.backends = {}
    yield
    channel_layers.backends = {}


async def _open(query=""):
    comm = WebsocketCommunicator(application, f"/ws/orders/{query}")
    connected, _ = await comm.connect()
    assert connected
    return comm


@pytest.mark.django_db(transaction=True)
@pytest.mark.anyio
async def test_auth_by_first_message(client_user):
    comm = await _open()
    await comm.send_to(text_data=json.dumps({"type": "auth", "token": str(AccessToken.for_user(client_user))}))
    msg = json.loads(await comm.receive_from(timeout=3))
    assert msg["type"] == "connection_established"
    assert f"client_{client_user.id}" in msg["groups"]
    await comm.send_to(text_data=json.dumps({"type": "ping"}))
    assert json.loads(await comm.receive_from(timeout=3))["type"] == "pong"
    await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.anyio
async def test_bad_token_is_refused(db):
    comm = await _open()
    await comm.send_to(text_data=json.dumps({"type": "auth", "token": "not.a.token"}))
    msg = json.loads(await comm.receive_from(timeout=3))
    assert msg["type"] == "auth_failed"
    out = await comm.receive_output(timeout=3)
    assert out["type"] == "websocket.close" and out.get("code") == 4001


@pytest.mark.django_db(transaction=True)
@pytest.mark.anyio
async def test_legacy_url_token_still_works(restaurateur_user, restaurant):
    comm = await _open(f"?token={AccessToken.for_user(restaurateur_user)}")
    msg = json.loads(await comm.receive_from(timeout=3))
    assert msg["type"] == "connection_established"
    assert f"restaurant_{restaurant.id}" in msg["groups"]
    await comm.disconnect()
