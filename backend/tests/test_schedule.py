"""Tests de la disponibilité programmée des plats (jours, plage horaire, plat du jour)."""
import pytest
from datetime import date, timedelta, time
from decimal import Decimal
from django.utils import timezone

from apps.menus.models import Category, MenuItem


@pytest.fixture
def owner_client(api_client, restaurateur_user):
    api_client.force_authenticate(restaurateur_user)
    return api_client


@pytest.fixture
def lunch(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Formule midi", price=Decimal("12.90"),
                                   available_days=[0, 1, 2, 3, 4], available_from=time(11, 30), available_until=time(14, 0))


def _order(client, restaurant, item, d, slot):
    return client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_date": d.isoformat(),
                                            "pickup_slot": slot, "items": [{"menu_item_id": str(item.id), "qty": 1}]}, format="json")


@pytest.mark.django_db
class TestSchedule:
    def test_labels_and_flags(self, owner_client, lunch):
        r = owner_client.get(f"/api/v1/menus/items/{lunch.id}/")
        assert r.data["is_scheduled"] is True
        assert r.data["schedule_label"] == "Lun–Ven · 11:30–14:00"
        assert r.data["available_days"] == [0, 1, 2, 3, 4]

    def test_order_outside_window_is_rejected(self, api_client, client_user, restaurant, lunch):
        api_client.force_authenticate(client_user)
        today = timezone.localdate()
        monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
        assert _order(api_client, restaurant, lunch, monday, "12:30").status_code == 201
        r = _order(api_client, restaurant, lunch, monday, "18:30")
        assert r.status_code == 400 and "n'est pas proposé" in str(r.data)
        saturday = monday + timedelta(days=5)
        assert _order(api_client, restaurant, lunch, saturday, "12:30").status_code == 400

    def test_daily_special(self, api_client, owner_client, client_user, restaurant, lunch):
        today = timezone.localdate()
        r = owner_client.patch(f"/api/v1/menus/items/{lunch.id}/", {"available_on": today.isoformat(), "available_days": [], "available_from": None, "available_until": None}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["schedule_label"].startswith("Plat du jour") and r.data["is_available_today"] is True
        api_client.force_authenticate(client_user)
        assert _order(api_client, restaurant, lunch, today, "23:59").status_code == 201
        assert _order(api_client, restaurant, lunch, today + timedelta(days=1), "12:30").status_code == 400

    def test_invalid_window(self, owner_client, lunch):
        r = owner_client.patch(f"/api/v1/menus/items/{lunch.id}/", {"available_from": "15:00", "available_until": "12:00"}, format="json")
        assert r.status_code == 400

    def test_counter_sale_ignores_schedule(self, owner_client, restaurant, lunch):
        r = owner_client.post("/api/v1/orders/counter/", {"restaurant": str(restaurant.id), "payment_method": "especes",
                                                          "items": [{"menu_item_id": str(lunch.id), "qty": 1}]}, format="json")
        assert r.status_code == 201
