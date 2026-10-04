"""Non-régression sécurité : escalade de rôle, commandes non modifiables, isolation entre restaurants, données privées."""
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.menus.models import Category, MenuItem
from apps.orders.models import Order, PromoCode
from apps.restaurants.models import Restaurant


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("10.00"))


def _order(client, restaurant, dish, **extra):
    body = {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
            "pickup_date": timezone.localdate().isoformat(), "items": [{"menu_item_id": str(dish.id), "qty": 1}], **extra}
    return client.post("/api/v1/orders/", body, format="json")


@pytest.mark.django_db
class TestRoles:
    def test_cannot_register_as_admin(self, api_client):
        r = api_client.post("/api/v1/auth/register/", {"email": "x@example.com", "password": "Secret1234!", "password2": "Secret1234!",
                                                      "first_name": "X", "last_name": "Y", "phone": "0470000000", "role": "admin"}, format="json")
        assert r.status_code == 400
        assert not User.objects.filter(email="x@example.com").exists()

    def test_me_cannot_change_role(self, api_client, client_user):
        api_client.force_authenticate(client_user)
        r = api_client.patch("/api/v1/auth/me/", {"role": "admin", "is_active": False, "first_name": "Jo"}, format="json")
        assert r.status_code == 200
        client_user.refresh_from_db()
        assert client_user.role == User.CLIENT and client_user.is_active and client_user.first_name == "Jo"


@pytest.mark.django_db
class TestOrdersLocked:
    def test_client_cannot_edit_or_delete_order(self, api_client, client_user, restaurant, dish):
        restaurant.is_open = True; restaurant.save()
        api_client.force_authenticate(client_user)
        oid = _order(api_client, restaurant, dish).data["id"]
        assert api_client.patch(f"/api/v1/orders/{oid}/", {"status": "recuperee"}, format="json").status_code == 405
        assert api_client.delete(f"/api/v1/orders/{oid}/").status_code == 405
        assert Order.objects.get(pk=oid).status == Order.NEW

    def test_past_slot_refused(self, api_client, client_user, restaurant, dish):
        restaurant.is_open = True; restaurant.save()
        api_client.force_authenticate(client_user)
        r = _order(api_client, restaurant, dish, pickup_date="2020-01-01")
        assert r.status_code == 400 and "passé" in str(r.data)

    def test_order_numbers_survive_deletion(self, api_client, client_user, restaurant, dish):
        restaurant.is_open = True; restaurant.save()
        api_client.force_authenticate(client_user)
        first = _order(api_client, restaurant, dish).data
        second = _order(api_client, restaurant, dish).data
        Order.objects.filter(pk=first["id"]).delete()
        third = _order(api_client, restaurant, dish)
        assert third.status_code == 201
        assert int(third.data["number"]) > int(second["number"])

    def test_stock_cannot_go_negative(self, api_client, client_user, restaurant, dish):
        restaurant.is_open = True; restaurant.save()
        MenuItem.objects.filter(pk=dish.pk).update(stock_qty=1)
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                                "pickup_date": timezone.localdate().isoformat(),
                                                "items": [{"menu_item_id": str(dish.id), "qty": 2}]}, format="json")
        assert r.status_code == 400
        dish.refresh_from_db()
        assert dish.stock_qty == 1

    def test_promo_max_uses_enforced(self, api_client, client_user, restaurant, dish):
        restaurant.is_open = True; restaurant.save()
        PromoCode.objects.create(restaurant=restaurant, code="ONCE", kind="percent", value=10, max_uses=1)
        api_client.force_authenticate(client_user)
        assert _order(api_client, restaurant, dish, promo_code="ONCE").status_code == 201
        r = _order(api_client, restaurant, dish, promo_code="ONCE")
        assert r.status_code == 400


@pytest.mark.django_db
class TestRestaurantPrivacy:
    def test_anonymous_sees_no_contract_fields(self, api_client, restaurant):
        r = api_client.get(f"/api/v1/restaurants/{restaurant.id}/")
        assert r.status_code == 200
        for f in ("owner_email", "commission_pct", "monthly_fee", "contract_notes", "monthly_due", "total_revenue"):
            assert f not in r.data
        assert "name" in r.data and "hours" in r.data

    def test_owner_and_admin_see_contract_fields(self, api_client, restaurant, restaurateur_user, admin_user):
        for u in (restaurateur_user, admin_user):
            api_client.force_authenticate(u)
            r = api_client.get(f"/api/v1/restaurants/{restaurant.id}/")
            assert "commission_pct" in r.data and "owner_email" in r.data

    @pytest.mark.platform_only          # en mode mono-restaurant, l'étape de validation n'existe pas
    def test_pending_restaurant_hidden_from_public(self, api_client, restaurant, restaurateur_user):
        Restaurant.objects.filter(pk=restaurant.pk).update(status=Restaurant.PENDING)
        assert api_client.get(f"/api/v1/restaurants/{restaurant.id}/").status_code == 404
        assert all(r["id"] != restaurant.id for r in api_client.get("/api/v1/restaurants/").data["results"])
        api_client.force_authenticate(restaurateur_user)
        assert api_client.get(f"/api/v1/restaurants/{restaurant.id}/").status_code == 200

    def test_client_cannot_create_restaurant(self, api_client, client_user):
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/restaurants/", {"name": "Pirate", "address": "x", "city": "y", "phone": "0470000000"}, format="json")
        assert r.status_code == 403


@pytest.mark.django_db
class TestMenuIsolation:
    def test_client_cannot_create_category_elsewhere(self, api_client, client_user, restaurant):
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/menus/categories/", {"restaurant": str(restaurant.id), "name": "Hack"}, format="json")
        assert r.status_code == 403
        assert not Category.objects.filter(name="Hack").exists()

    def test_item_cannot_move_to_other_restaurant(self, api_client, restaurateur_user, restaurant, dish, admin_user):
        other_owner = User.objects.create_user(email="other@test.com", password="pass1234", role=User.RESTAURATEUR)
        other = Restaurant.objects.create(owner=other_owner, name="Autre", slug="autre", address="a", city="b", phone="0", status="active")
        other_cat = Category.objects.create(restaurant=other, name="Plats")
        api_client.force_authenticate(restaurateur_user)
        r = api_client.patch(f"/api/v1/menus/items/{dish.id}/", {"category": other_cat.id}, format="json")
        assert r.status_code == 403
        dish.refresh_from_db()
        assert dish.category.restaurant_id == restaurant.id
