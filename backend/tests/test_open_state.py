"""Ouverture effective : interrupteur du restaurateur ET horaires du jour."""
from datetime import datetime, time
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from decimal import Decimal

from apps.menus.models import Category, MenuItem
from apps.restaurants.models import BusinessHours


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("10.00"))

TZ = ZoneInfo("Europe/Brussels")


def at(weekday, hh, mm):
    """Un datetime local un jour donné (0 = lundi) à l'heure donnée (semaine du 5 janvier 2026)."""
    return timezone.make_aware(datetime(2026, 1, 5 + weekday, hh, mm), TZ)


@pytest.mark.django_db
class TestOpenState:
    def test_switch_off_wins(self, restaurant):
        restaurant.is_open = False
        restaurant.save()
        assert restaurant.open_state(at(0, 12, 0)) == (False, "Fermé")

    def test_no_hours_means_switch_only(self, restaurant):
        restaurant.is_open = True
        restaurant.save()
        assert restaurant.open_state(at(0, 3, 0)) == (True, "Ouvert")

    def test_hours_of_the_day(self, restaurant):
        restaurant.is_open = True
        restaurant.save()
        BusinessHours.objects.create(restaurant=restaurant, day_of_week=0, open_time=time(11, 30), close_time=time(22, 0))
        BusinessHours.objects.create(restaurant=restaurant, day_of_week=1, is_open=False)
        restaurant = type(restaurant).objects.prefetch_related("hours").get(pk=restaurant.pk)
        assert restaurant.open_state(at(0, 9, 0)) == (False, "Fermé · ouvre à 11:30")
        assert restaurant.open_state(at(0, 12, 0)) == (True, "Ouvert · ferme à 22:00")
        assert restaurant.open_state(at(0, 23, 0)) == (False, "Fermé · horaires terminés")
        assert restaurant.open_state(at(1, 12, 0)) == (False, "Fermé aujourd'hui")
        assert restaurant.open_state(at(2, 4, 0)) == (True, "Ouvert")        # mercredi : pas d'horaires → interrupteur

    def test_overnight_hours(self, restaurant):
        restaurant.is_open = True
        restaurant.save()
        BusinessHours.objects.create(restaurant=restaurant, day_of_week=4, open_time=time(18, 0), close_time=time(2, 0))
        restaurant = type(restaurant).objects.prefetch_related("hours").get(pk=restaurant.pk)
        assert restaurant.open_state(at(4, 23, 30))[0] is True
        assert restaurant.open_state(at(4, 1, 0))[0] is True
        assert restaurant.open_state(at(4, 12, 0))[0] is False

    def test_order_refused_outside_hours(self, api_client, client_user, restaurant, dish):
        restaurant.is_open = True
        restaurant.save()
        BusinessHours.objects.create(restaurant=restaurant, day_of_week=timezone.localtime().weekday(),
                                     open_time=time(0, 0), close_time=time(0, 1))
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/orders/", {
            "restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "12:00",
            "pickup_date": timezone.localdate().isoformat(), "items": [{"menu_item_id": str(dish.id), "qty": 1}],
        }, format="json")
        assert r.status_code == 400
        assert "fermé" in str(r.data).lower()

    def test_serializer_exposes_state(self, api_client, restaurant):
        restaurant.is_open = True
        restaurant.save()
        r = api_client.get(f"/api/v1/restaurants/{restaurant.id}/")
        assert r.status_code == 200
        assert r.data["is_open_now"] is True
        assert r.data["open_status"] == "Ouvert"
