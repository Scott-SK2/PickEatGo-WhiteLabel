"""Tests des notifications push : abonnement, envoi (webpush simulé), messages de statut."""
import pytest
from decimal import Decimal
from django.utils import timezone
from apps.menus.models import Category, MenuItem
from apps.notifications.models import PushSubscription
from apps.notifications import push as push_service

SUB = {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "p", "auth": "a"}}


@pytest.fixture
def vapid(settings):
    settings.VAPID_PUBLIC_KEY = "pub"; settings.VAPID_PRIVATE_KEY = "priv"


@pytest.mark.django_db
class TestPush:
    def test_key_endpoint_reports_state(self, api_client, settings):
        assert api_client.get("/api/v1/notifications/push/key/").data["enabled"] is False
        settings.VAPID_PUBLIC_KEY = "pub"; settings.VAPID_PRIVATE_KEY = "priv"
        r = api_client.get("/api/v1/notifications/push/key/")
        assert r.data == {"enabled": True, "public_key": "pub"}

    def test_subscribe_and_unsubscribe(self, api_client, client_user):
        assert api_client.post("/api/v1/notifications/push/subscription/", SUB, format="json").status_code == 401
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/notifications/push/subscription/", SUB, format="json")
        assert r.status_code == 201 and PushSubscription.objects.count() == 1
        r = api_client.get("/api/v1/notifications/push/subscription/?endpoint=" + SUB["endpoint"])
        assert r.data["subscribed"] is True and r.data["devices"] == 1
        assert api_client.post("/api/v1/notifications/push/subscription/", {"endpoint": "http://insecure"}, format="json").status_code == 400
        r = api_client.delete("/api/v1/notifications/push/subscription/", {"endpoint": SUB["endpoint"]}, format="json")
        assert r.status_code == 200 and PushSubscription.objects.count() == 0

    def test_status_change_sends_push_to_client(self, api_client, client_user, restaurant, vapid, monkeypatch):
        sent = []
        monkeypatch.setattr(push_service, "_deliver", lambda ids, payload: sent.append((list(ids), payload)))
        cat = Category.objects.create(restaurant=restaurant, name="Plats")
        dish = MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"))
        api_client.force_authenticate(client_user)
        api_client.post("/api/v1/notifications/push/subscription/", SUB, format="json")
        o = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                                 "pickup_date": timezone.localdate().isoformat(),
                                                 "items": [{"menu_item_id": str(dish.id), "qty": 1}]}, format="json").data
        api_client.force_authenticate(restaurant.owner)
        api_client.patch(f"/api/v1/orders/{o['id']}/advance/", {}, format="json")   # → confirmée
        assert len(sent) == 1
        assert sent[0][1]["title"].startswith("Commande confirmée") and "#" + o["number"] in sent[0][1]["body"]
        for _ in range(2):
            api_client.patch(f"/api/v1/orders/{o['id']}/advance/", {}, format="json")   # → en cuisine → prête
        assert sent[-1][1]["title"].startswith("C'est prêt")

    def test_test_endpoint_without_keys(self, api_client, client_user):
        api_client.force_authenticate(client_user)
        assert api_client.post("/api/v1/notifications/push/test/").status_code == 503
