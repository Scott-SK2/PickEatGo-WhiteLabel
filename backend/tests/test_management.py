"""
Tests des fonctions de gestion : stock par plat, ventes comptoir, rapports, clôture.
"""
import pytest
from decimal import Decimal
from django.urls import reverse
from django.utils import timezone

from apps.menus.models import Category, MenuItem, StockMovement
from apps.orders.models import Order, DailyClosure


@pytest.fixture
def menu(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats", order=0)
    burger = MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"),
                                     cost_price=Decimal("3.00"), stock_qty=5, low_stock_threshold=2)
    frites = MenuItem.objects.create(category=cat, name="Frites", price=Decimal("3.50"))  # stock non suivi
    return {"cat": cat, "burger": burger, "frites": frites}


@pytest.fixture
def owner_client(api_client, restaurateur_user):
    api_client.force_authenticate(restaurateur_user)
    return api_client


def _counter_payload(restaurant, item, qty=1, payment="especes"):
    return {"restaurant": str(restaurant.id), "payment_method": payment,
            "items": [{"menu_item_id": str(item.id), "qty": qty}]}


@pytest.mark.django_db
class TestStock:
    def test_set_stock_creates_inventory_movement(self, owner_client, menu):
        r = owner_client.post(f"/api/v1/menus/items/{menu['frites'].id}/stock/", {"mode": "set", "qty": 20}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["item"]["stock_qty"] == 20
        assert r.data["item"]["track_stock"] is True
        assert r.data["movement"]["reason"] == "inventaire"
        assert r.data["movement"]["delta"] == 20

    def test_restock_and_untrack(self, owner_client, menu):
        r = owner_client.post(f"/api/v1/menus/items/{menu['burger'].id}/stock/", {"mode": "add", "qty": 10, "note": "livraison"}, format="json")
        assert r.status_code == 200
        assert r.data["item"]["stock_qty"] == 15
        assert r.data["movement"]["reason"] == "reappro"
        r = owner_client.post(f"/api/v1/menus/items/{menu['burger'].id}/stock/", {"track": False}, format="json")
        assert r.status_code == 200
        assert r.data["item"]["stock_qty"] is None
        assert r.data["item"]["track_stock"] is False

    def test_add_requires_tracking(self, owner_client, menu):
        r = owner_client.post(f"/api/v1/menus/items/{menu['frites'].id}/stock/", {"mode": "add", "qty": 3}, format="json")
        assert r.status_code == 400

    def test_waste_is_valued_at_cost_price(self, owner_client, menu):
        r = owner_client.post(f"/api/v1/menus/items/{menu['burger'].id}/waste/", {"qty": 2, "note": "invendus"}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["item"]["stock_qty"] == 3
        assert r.data["movement"]["reason"] == "perte"
        assert Decimal(r.data["movement"]["value"]) == Decimal("6.00")

    def test_out_of_stock_disables_item_and_restock_reenables(self, owner_client, menu):
        burger = menu["burger"]
        owner_client.post(f"/api/v1/menus/items/{burger.id}/waste/", {"qty": 5}, format="json")
        burger.refresh_from_db()
        assert burger.stock_qty == 0 and burger.is_available is False and burger.auto_disabled is True
        # Impossible de le réactiver à la main tant qu'il est épuisé
        r = owner_client.patch(f"/api/v1/menus/items/{burger.id}/toggle-availability/", {}, format="json")
        assert r.status_code == 400
        owner_client.post(f"/api/v1/menus/items/{burger.id}/stock/", {"mode": "add", "qty": 4}, format="json")
        burger.refresh_from_db()
        assert burger.stock_qty == 4 and burger.is_available is True and burger.auto_disabled is False

    def test_stock_alerts(self, owner_client, restaurant, menu):
        owner_client.post(f"/api/v1/menus/items/{menu['burger'].id}/waste/", {"qty": 4}, format="json")  # reste 1 ≤ seuil 2
        r = owner_client.get(f"/api/v1/menus/items/stock-alerts/?restaurant={restaurant.id}")
        assert r.status_code == 200
        assert r.data["count"] == 1
        assert r.data["low"][0]["name"] == "Burger"
        assert r.data["out"] == []

    def test_movements_history_is_scoped_to_owner(self, api_client, owner_client, restaurant, menu, client_user):
        owner_client.post(f"/api/v1/menus/items/{menu['burger'].id}/stock/", {"mode": "add", "qty": 1}, format="json")
        r = owner_client.get(f"/api/v1/menus/stock-movements/?restaurant={restaurant.id}")
        assert r.status_code == 200 and r.data["count"] == 1
        api_client.force_authenticate(client_user)
        r = api_client.get(f"/api/v1/menus/stock-movements/?restaurant={restaurant.id}")
        assert r.status_code == 200 and r.data["count"] == 0


@pytest.mark.django_db
class TestCounterSale:
    def test_counter_sale_creates_completed_order_and_consumes_stock(self, owner_client, restaurant, menu, restaurateur_user):
        r = owner_client.post("/api/v1/orders/counter/", _counter_payload(restaurant, menu["burger"], qty=2, payment="carte"), format="json")
        assert r.status_code == 201, r.data
        assert r.data["order_type"] == "comptoir"
        assert r.data["status"] == "recuperee"
        assert r.data["payment_method"] == "carte"
        assert r.data["client_name"] == "Vente comptoir"
        assert Decimal(r.data["total_price"]) == Decimal("19.00")
        menu["burger"].refresh_from_db()
        assert menu["burger"].stock_qty == 3
        mv = StockMovement.objects.get(reason=StockMovement.SALE)
        assert mv.delta == -2 and mv.user == restaurateur_user

    def test_counter_sale_rejects_insufficient_stock(self, owner_client, restaurant, menu):
        r = owner_client.post("/api/v1/orders/counter/", _counter_payload(restaurant, menu["burger"], qty=6), format="json")
        assert r.status_code == 400
        assert "Stock insuffisant" in str(r.data)

    def test_counter_sale_forbidden_for_other_users(self, api_client, restaurant, menu, client_user):
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/orders/counter/", _counter_payload(restaurant, menu["burger"]), format="json")
        assert r.status_code == 403

    def test_online_order_consumes_stock_and_cancel_restores_it(self, api_client, client_user, restaurant, menu):
        api_client.force_authenticate(client_user)
        today = timezone.localdate().isoformat()
        r = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter",
                                                 "pickup_slot": "23:59", "pickup_date": today,
                                                 "items": [{"menu_item_id": str(menu["burger"].id), "qty": 3}]}, format="json")
        assert r.status_code == 201, r.data
        menu["burger"].refresh_from_db()
        assert menu["burger"].stock_qty == 2
        r = api_client.patch(f"/api/v1/orders/{r.data['id']}/cancel/", {}, format="json")
        assert r.status_code == 200
        menu["burger"].refresh_from_db()
        assert menu["burger"].stock_qty == 5
        assert StockMovement.objects.filter(reason=StockMovement.CANCEL).count() == 1

    def test_advance_records_payment_method(self, api_client, owner_client, client_user, restaurant, menu):
        api_client.force_authenticate(client_user)
        today = timezone.localdate().isoformat()
        r = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter",
                                                 "pickup_slot": "23:59", "pickup_date": today,
                                                 "items": [{"menu_item_id": str(menu["frites"].id), "qty": 1}]}, format="json")
        oid = r.data["id"]
        owner_client.force_authenticate(restaurant.owner)
        for _ in range(3):
            owner_client.patch(f"/api/v1/orders/{oid}/advance/", {}, format="json")
        r = owner_client.patch(f"/api/v1/orders/{oid}/advance/", {"payment_method": "especes"}, format="json")
        assert r.status_code == 200 and r.data["status"] == "recuperee"
        assert Order.objects.get(id=oid).payment_method == "especes"


@pytest.mark.django_db
class TestReportsAndClosure:
    @pytest.fixture
    def sales(self, owner_client, restaurant, menu):
        owner_client.post("/api/v1/orders/counter/", _counter_payload(restaurant, menu["burger"], qty=2, payment="carte"), format="json")
        owner_client.post("/api/v1/orders/counter/", _counter_payload(restaurant, menu["frites"], qty=3, payment="especes"), format="json")
        owner_client.post(f"/api/v1/menus/items/{menu['burger'].id}/waste/", {"qty": 1}, format="json")

    def test_sales_summary(self, owner_client, restaurant, sales):
        today = timezone.localdate().isoformat()
        r = owner_client.get(f"/api/v1/orders/sales/?restaurant={restaurant.id}&from={today}&to={today}")
        assert r.status_code == 200, r.data
        t = r.data["totals"]
        assert t["orders"] == 2 and t["items_sold"] == 5
        assert Decimal(t["revenue"]) == Decimal("29.50")
        assert t["counter_orders"] == 2 and t["waste_count"] == 1
        assert Decimal(t["waste_value"]) == Decimal("3.00")
        products = {p["name"]: p for p in r.data["by_product"]}
        assert products["Frites"]["qty"] == 3
        assert Decimal(products["Burger"]["margin"]) == Decimal("13.00")   # 19.00 - 2×3.00
        assert products["Frites"]["margin"] is None                      # pas de prix de revient
        payments = {p["key"]: p for p in r.data["by_payment"]}
        assert Decimal(payments["carte"]["revenue"]) == Decimal("19.00")
        assert len(r.data["periods"]) == 1

    def test_sales_forbidden_for_other_restaurateur(self, api_client, restaurant, django_user_model):
        other = django_user_model.objects.create_user(email="other@test.com", password="pass1234", role="restaurateur",
                                                      first_name="O", last_name="T")
        api_client.force_authenticate(other)
        r = api_client.get(f"/api/v1/orders/sales/?restaurant={restaurant.id}")
        assert r.status_code == 403

    def test_export_csv_and_xlsx(self, owner_client, restaurant, sales):
        r = owner_client.get(f"/api/v1/orders/sales/export/?restaurant={restaurant.id}&type=csv")
        assert r.status_code == 200 and r["Content-Type"].startswith("text/csv")
        body = r.content.decode("utf-8-sig")
        assert "Burger" in body and body.count("\n") == 3   # en-tête + 2 lignes
        r = owner_client.get(f"/api/v1/orders/sales/export/?restaurant={restaurant.id}&type=xlsx")
        assert r.status_code == 200 and r.content[:2] == b"PK"

    def test_daily_stats(self, owner_client, restaurant, sales):
        r = owner_client.get(f"/api/v1/orders/stats/?restaurant={restaurant.id}&days=7")
        assert r.status_code == 200
        assert len(r.data["days"]) == 7
        assert r.data["days"][-1]["label"] == "Auj" and r.data["days"][-1]["orders"] == 2

    def test_closure_preview_create_and_duplicate(self, owner_client, restaurant, sales, restaurateur_user):
        r = owner_client.get(f"/api/v1/orders/closures/preview/?restaurant={restaurant.id}")
        assert r.status_code == 200 and r.data["already_closed"] is None
        assert Decimal(r.data["total_cash"]) == Decimal("10.50")
        r = owner_client.post("/api/v1/orders/closures/", {"restaurant": str(restaurant.id), "note": "RAS"}, format="json")
        assert r.status_code == 201, r.data
        assert Decimal(r.data["total"]) == Decimal("29.50") and r.data["closed_by_name"] == restaurateur_user.full_name
        assert r.data["items_summary"][0]["qty"] == 3
        r = owner_client.post("/api/v1/orders/closures/", {"restaurant": str(restaurant.id)}, format="json")
        assert r.status_code == 400
        r = owner_client.get(f"/api/v1/orders/closures/?restaurant={restaurant.id}")
        assert r.status_code == 200 and r.data["count"] == 1
        assert DailyClosure.objects.count() == 1


@pytest.mark.django_db
class TestCustomers:
    @pytest.fixture
    def orders(self, api_client, owner_client, client_user, restaurant, menu):
        api_client.force_authenticate(client_user)
        today = timezone.localdate().isoformat()
        ids = []
        for qty in (1, 2):
            r = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter",
                                                     "pickup_slot": "23:59", "pickup_date": today,
                                                     "items": [{"menu_item_id": str(menu["frites"].id), "qty": qty}]}, format="json")
            ids.append(r.data["id"])
        owner_client.force_authenticate(restaurant.owner)
        for _ in range(4):
            owner_client.patch(f"/api/v1/orders/{ids[0]}/advance/", {}, format="json")   # → récupérée (3.50)
        owner_client.post("/api/v1/orders/counter/", _counter_payload(restaurant, menu["burger"]), format="json")  # comptoir : exclu
        return ids

    def test_customers_list_and_privacy(self, owner_client, restaurant, client_user, orders):
        r = owner_client.get(f"/api/v1/orders/customers/?restaurant={restaurant.id}")
        assert r.status_code == 200, r.data
        assert r.data["stats"]["customers"] == 1
        c = r.data["customers"][0]
        assert c["name"] == client_user.full_name and c["orders"] == 2 and c["completed"] == 1
        assert Decimal(c["total_spent"]) == Decimal("3.50") and c["favorite"] == "Frites"
        assert c["contact_visible"] is True and c["email"] == client_user.email
        # Le client masque ses coordonnées → plus de téléphone ni d'e-mail
        client_user.phone_visible = False
        client_user.save()
        r = owner_client.get(f"/api/v1/orders/customers/?restaurant={restaurant.id}")
        c = r.data["customers"][0]
        assert c["contact_visible"] is False and c["phone"] is None and c["email"] is None

    def test_customers_search_and_export(self, owner_client, restaurant, orders):
        r = owner_client.get(f"/api/v1/orders/customers/?restaurant={restaurant.id}&search=zzz")
        assert r.status_code == 200 and r.data["customers"] == [] and r.data["stats"]["customers"] == 1
        r = owner_client.get(f"/api/v1/orders/customers/?restaurant={restaurant.id}&type=csv")
        assert r.status_code == 200 and r["Content-Type"].startswith("text/csv")
        assert "Jean Dupont" in r.content.decode("utf-8-sig")

    def test_customers_forbidden_for_client(self, api_client, restaurant, client_user):
        api_client.force_authenticate(client_user)
        r = api_client.get(f"/api/v1/orders/customers/?restaurant={restaurant.id}")
        assert r.status_code == 403
