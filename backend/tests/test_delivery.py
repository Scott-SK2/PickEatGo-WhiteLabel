"""Tests des modes de commande (sur place / emporter / livraison) et des conditions de livraison."""
import pytest
from datetime import time
from decimal import Decimal
from django.utils import timezone
from apps.menus.models import Category, MenuItem


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("10.00"))


def _order(client, restaurant, dish, **extra):
    body = {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
            "pickup_date": timezone.localdate().isoformat(), "items": [{"menu_item_id": str(dish.id), "qty": 2}], **extra}
    return client.post("/api/v1/orders/", body, format="json")


@pytest.mark.django_db
class TestOrderModes:
    def test_disabled_mode_is_refused(self, api_client, client_user, restaurant, dish):
        restaurant.allow_on_site = False; restaurant.save()
        api_client.force_authenticate(client_user)
        r = _order(api_client, restaurant, dish, order_type="sur_place")
        assert r.status_code == 400 and "Sur place" in str(r.data)
        assert _order(api_client, restaurant, dish, order_type="emporter").status_code == 201
        assert _order(api_client, restaurant, dish, order_type="livraison", delivery_address="1 rue X").status_code == 400   # livraison désactivée

    def test_owner_cannot_disable_every_mode(self, api_client, restaurant):
        api_client.force_authenticate(restaurant.owner)
        r = api_client.patch(f"/api/v1/restaurants/{restaurant.id}/", {"allow_on_site": False, "allow_pickup": False, "allow_delivery": False}, format="json")
        assert r.status_code == 400

    def test_delivery_rules(self, api_client, client_user, restaurant, dish):
        api_client.force_authenticate(restaurant.owner)
        r = api_client.patch(f"/api/v1/restaurants/{restaurant.id}/", {"allow_delivery": True, "delivery_fee": "2.50", "delivery_min_order": "15",
                                                                        "delivery_days": [0, 1, 2, 3, 4], "delivery_from": "18:00", "delivery_until": "21:30",
                                                                        "delivery_info": "Bruxelles centre uniquement"}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["delivery_schedule_label"] == "Lun–Ven · 18:00–21:30"
        api_client.force_authenticate(client_user)
        from datetime import timedelta
        today = timezone.localdate()
        monday = (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()
        assert _order(api_client, restaurant, dish, order_type="livraison", pickup_date=monday).status_code == 400          # adresse manquante
        r = _order(api_client, restaurant, dish, order_type="livraison", pickup_date=monday, pickup_slot="12:00", delivery_address="1 rue X")
        assert r.status_code == 400 and "18:00" in str(r.data)                                                            # hors créneau
        r = _order(api_client, restaurant, dish, order_type="livraison", pickup_date=monday, pickup_slot="19:00", delivery_address="1 rue X")
        assert r.status_code == 201, r.data
        assert r.data["order_type"] == "livraison" and Decimal(r.data["delivery_fee"]) == Decimal("2.50")
        assert Decimal(r.data["total_price"]) == Decimal("22.50") and Decimal(r.data["subtotal"]) == Decimal("20.00")
        # Minimum de commande
        restaurant.refresh_from_db(); restaurant.delivery_min_order = Decimal("30"); restaurant.save()
        r = _order(api_client, restaurant, dish, order_type="livraison", pickup_date=monday, pickup_slot="19:00", delivery_address="1 rue X")
        assert r.status_code == 400 and "30.00" in str(r.data)


@pytest.mark.django_db
class TestDeliveryStatusAndFees:
    def _deliver(self, api_client, client_user, restaurant, dish, **extra):
        from datetime import timedelta
        today = timezone.localdate()
        api_client.force_authenticate(client_user)
        monday = (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()
        extra.setdefault("pickup_date", monday)
        return _order(api_client, restaurant, dish, order_type="livraison", pickup_slot="19:00", delivery_address="1 rue X", **extra)

    def test_delivery_goes_through_en_livraison(self, api_client, client_user, restaurant, dish):
        restaurant.allow_delivery = True; restaurant.save()
        o = self._deliver(api_client, client_user, restaurant, dish).data
        api_client.force_authenticate(restaurant.owner)
        seen = [api_client.patch(f"/api/v1/orders/{o['id']}/advance/", {}, format="json").data["status"] for _ in range(5)]
        assert seen == ["confirmee", "en_cuisine", "prete", "en_livraison", "recuperee"]
        # Une commande à emporter ne passe pas par « en livraison »
        api_client.force_authenticate(client_user)
        o2 = _order(api_client, restaurant, dish).data
        api_client.force_authenticate(restaurant.owner)
        seen = [api_client.patch(f"/api/v1/orders/{o2['id']}/advance/", {}, format="json").data["status"] for _ in range(4)]
        assert seen == ["confirmee", "en_cuisine", "prete", "recuperee"]

    def test_zone_fees_and_free_above(self, api_client, client_user, restaurant, dish):
        api_client.force_authenticate(restaurant.owner)
        r = api_client.patch(f"/api/v1/restaurants/{restaurant.id}/", {"allow_delivery": True, "delivery_fee_mode": "zones", "delivery_free_above": "30",
            "delivery_zones": [{"label": "Centre", "postcodes": "1000, 1050", "fee": "2,50"}, {"label": "Périphérie", "postcodes": ["1800"], "fee": "5"}]}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["delivery_zones"][0] == {"label": "Centre", "postcodes": ["1000", "1050"], "fee": "2.50"}
        # Devis public (sans connexion)
        api_client.force_authenticate(None)
        q = api_client.post("/api/v1/orders/delivery/quote/", {"restaurant": str(restaurant.id), "postcode": "1800", "subtotal": "20"}, format="json")
        assert q.status_code == 200 and q.data["fee"] == "5.00" and q.data["free"] is False
        q = api_client.post("/api/v1/orders/delivery/quote/", {"restaurant": str(restaurant.id), "postcode": "1000", "subtotal": "40"}, format="json")
        assert q.data["fee"] == "0.00" and q.data["free"] is True                      # offerte dès 30 €
        q = api_client.post("/api/v1/orders/delivery/quote/", {"restaurant": str(restaurant.id), "postcode": "9000", "subtotal": "20"}, format="json")
        assert q.status_code == 400 and "9000" in q.data["detail"]
        # Commande : frais de la zone appliqués, code postal inconnu refusé
        r = self._deliver(api_client, client_user, restaurant, dish, delivery_postcode="1800")
        assert r.status_code == 201 and Decimal(r.data["delivery_fee"]) == Decimal("5.00") and Decimal(r.data["total_price"]) == Decimal("25.00")
        r = self._deliver(api_client, client_user, restaurant, dish, delivery_postcode="9000")
        assert r.status_code == 400 and "9000" in str(r.data)
        r = self._deliver(api_client, client_user, restaurant, dish)
        assert r.status_code == 400 and "code postal" in str(r.data)
