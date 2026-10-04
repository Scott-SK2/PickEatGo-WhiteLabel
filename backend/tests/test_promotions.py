"""Tests fidélité, codes promo, comparaison de périodes et bilan hebdomadaire."""
import pytest
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone

from apps.menus.models import Category, MenuItem
from apps.orders.models import Order, PromoCode


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("10.00"))


@pytest.fixture
def owner_client(api_client, restaurateur_user):
    api_client.force_authenticate(restaurateur_user)
    return api_client


def _order(client, restaurant, dish, qty=1, **extra):
    return client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                            "pickup_date": timezone.localdate().isoformat(),
                                            "items": [{"menu_item_id": str(dish.id), "qty": qty}], **extra}, format="json")


def _complete(client, owner, oid):
    client.force_authenticate(owner)
    for _ in range(4):
        client.patch(f"/api/v1/orders/{oid}/advance/", {}, format="json")


@pytest.mark.django_db
class TestPromoCodes:
    def test_crud_and_validation(self, owner_client, restaurant):
        r = owner_client.post("/api/v1/orders/promos/", {"restaurant": str(restaurant.id), "code": "bienvenue10", "kind": "percent", "value": "10"}, format="json")
        assert r.status_code == 201, r.data
        assert r.data["code"] == "BIENVENUE10" and r.data["label"] == "-10 %"
        assert owner_client.post("/api/v1/orders/promos/", {"restaurant": str(restaurant.id), "code": "X", "kind": "percent", "value": "150"}, format="json").status_code == 400
        assert owner_client.get(f"/api/v1/orders/promos/?restaurant={restaurant.id}").data["count"] == 1

    def test_check_and_apply_on_order(self, api_client, owner_client, restaurant, dish, client_user):
        PromoCode.objects.create(restaurant=restaurant, code="FIVE", kind="amount", value=Decimal("5"), min_order=Decimal("15"), max_uses=1)
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/orders/promo/check/", {"restaurant": str(restaurant.id), "code": "five", "subtotal": "10"}, format="json")
        assert r.status_code == 400 and "à partir de" in r.data["detail"]
        r = api_client.post("/api/v1/orders/promo/check/", {"restaurant": str(restaurant.id), "code": "five", "subtotal": "20"}, format="json")
        assert r.status_code == 200 and r.data["discount"] == "5.00" and r.data["total"] == "15.00"
        r = _order(api_client, restaurant, dish, qty=2, promo_code="five")
        assert r.status_code == 201, r.data
        assert Decimal(r.data["total_price"]) == Decimal("15.00") and Decimal(r.data["discount_amount"]) == Decimal("5.00")
        assert r.data["discount_label"].startswith("Code FIVE") and Decimal(r.data["subtotal"]) == Decimal("20.00")
        assert PromoCode.objects.get(code="FIVE").uses == 1
        # Quota atteint → refus explicite
        r2 = _order(api_client, restaurant, dish, qty=2, promo_code="FIVE")
        assert r2.status_code == 400 and "maximum" in str(r2.data)
        # Annulation → l'utilisation est rendue
        api_client.patch(f"/api/v1/orders/{r.data['id']}/cancel/", {}, format="json")
        assert PromoCode.objects.get(code="FIVE").uses == 0

    def test_unknown_code_is_rejected(self, api_client, restaurant, dish, client_user):
        api_client.force_authenticate(client_user)
        r = _order(api_client, restaurant, dish, promo_code="NOPE")
        assert r.status_code == 400 and "inconnu" in str(r.data).lower()


@pytest.mark.django_db
class TestLoyalty:
    def test_reward_after_target_orders(self, api_client, restaurant, dish, client_user):
        restaurant.loyalty_enabled = True; restaurant.loyalty_target = 2
        restaurant.loyalty_reward_type = "percent"; restaurant.loyalty_reward_value = Decimal("50")
        restaurant.save()
        api_client.force_authenticate(client_user)
        assert api_client.get(f"/api/v1/orders/loyalty/?restaurant={restaurant.id}").data["stamps"] == 0
        for _ in range(2):
            o = _order(api_client, restaurant, dish).data
            assert o["loyalty_reward"] is False
            _complete(api_client, restaurant.owner, o["id"])
            api_client.force_authenticate(client_user)
        st = api_client.get(f"/api/v1/orders/loyalty/?restaurant={restaurant.id}").data
        assert st["stamps"] == 2 and st["reward_ready"] is True and st["reward_label"] == "-50 % fidélité"
        r = _order(api_client, restaurant, dish, qty=2)
        assert r.status_code == 201 and r.data["loyalty_reward"] is True
        assert Decimal(r.data["total_price"]) == Decimal("10.00") and "fidélité" in r.data["discount_label"]
        # Compteur remis à zéro tant que la commande récompensée est en cours
        st = api_client.get(f"/api/v1/orders/loyalty/?restaurant={restaurant.id}").data
        assert st["reward_ready"] is False
        _complete(api_client, restaurant.owner, r.data["id"])
        api_client.force_authenticate(client_user)
        assert api_client.get(f"/api/v1/orders/loyalty/?restaurant={restaurant.id}").data["stamps"] == 0

    def test_disabled_program(self, api_client, restaurant, client_user):
        api_client.force_authenticate(client_user)
        assert api_client.get(f"/api/v1/orders/loyalty/?restaurant={restaurant.id}").data == {"enabled": False}


@pytest.mark.django_db
class TestComparisonAndWeekly:
    def test_previous_period_and_best_day(self, owner_client, restaurant, dish, restaurateur_user):
        today = timezone.localdate()
        def sale(days_ago, total):
            o = Order.objects.create(restaurant=restaurant, client=None, order_type="comptoir", status="recuperee", payment_method="carte",
                                     pickup_date=today, pickup_slot="12:00", total_price=Decimal(total), created_by=restaurateur_user)
            Order.objects.filter(pk=o.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
        sale(0, "30"); sale(1, "10")          # période courante (2 jours) : 40 €
        sale(2, "10"); sale(3, "10")          # période précédente : 20 €
        r = owner_client.get(f"/api/v1/orders/sales/?restaurant={restaurant.id}&from={(today - timedelta(days=1)).isoformat()}&to={today.isoformat()}")
        assert r.status_code == 200, r.data
        assert r.data["previous"]["revenue"] == "20.00" and r.data["previous"]["delta"]["revenue"] == 100.0
        assert r.data["totals"]["best_period"]["revenue"] == "30.00" and r.data["totals"]["best_hour"] is not None

    def test_weekly_report_dry_run(self, restaurant, capsys):
        from django.core.management import call_command
        call_command("weekly_report", "--dry-run")
        out = capsys.readouterr().out
        assert "Bilan de la semaine" in out and restaurant.owner.email in out
