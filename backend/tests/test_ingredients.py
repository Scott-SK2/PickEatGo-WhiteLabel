"""
Tests des ingrédients, recettes et fournisseurs : consommation à la vente,
plat limité par un ingrédient, coût matière calculé, liste de courses.
"""
import pytest
from decimal import Decimal
from django.utils import timezone

from apps.menus.models import Category, MenuItem, Ingredient, IngredientMovement, Supplier


@pytest.fixture
def owner_client(api_client, restaurateur_user):
    api_client.force_authenticate(restaurateur_user)
    return api_client


@pytest.fixture
def kitchen(restaurant):
    """Burger = 1 pain + 0.15 kg steak. Stock : 10 pains, 1.2 kg de steak (→ 8 portions)."""
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    burger = MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"))
    frites = MenuItem.objects.create(category=cat, name="Frites", price=Decimal("3.50"), stock_qty=20)
    boucher = Supplier.objects.create(restaurant=restaurant, name="Boucherie Dupont", phone="0470")
    pain  = Ingredient.objects.create(restaurant=restaurant, name="Pain burger", unit="pc", stock_qty=10,
                                      low_stock_threshold=4, unit_cost=Decimal("0.40"))
    steak = Ingredient.objects.create(restaurant=restaurant, name="Steak haché", unit="kg", stock_qty=Decimal("1.2"),
                                      low_stock_threshold=Decimal("0.5"), unit_cost=Decimal("12.00"),
                                      supplier=boucher, reorder_qty=Decimal("5"))
    return {"cat": cat, "burger": burger, "frites": frites, "pain": pain, "steak": steak, "boucher": boucher}


def _set_recipe(client, item, lines):
    return client.put(f"/api/v1/menus/items/{item.id}/recipe/",
                      {"lines": [{"ingredient": str(i.id), "qty": str(q)} for i, q in lines]}, format="json")


@pytest.mark.django_db
class TestRecipe:
    def test_recipe_computes_cost_and_portions(self, owner_client, kitchen):
        r = _set_recipe(owner_client, kitchen["burger"], [(kitchen["pain"], 1), (kitchen["steak"], "0.15")])
        assert r.status_code == 200, r.data
        item = r.data["item"]
        assert item["has_recipe"] is True
        assert item["portions_available"] == 8 and item["limited_by"] == "Steak haché"
        assert item["effective_stock"] == 8
        assert Decimal(item["cost_price"]) == Decimal("2.20")        # 0.40 + 0.15 × 12
        assert len(item["recipe"]) == 2

    def test_recipe_rejects_foreign_ingredient(self, owner_client, kitchen, django_user_model):
        other_owner = django_user_model.objects.create_user(email="o@t.com", password="x", role="restaurateur")
        from apps.restaurants.models import Restaurant
        other = Restaurant.objects.create(owner=other_owner, name="Autre", slug="autre", cuisine="x", address="x", phone="x", status="active")
        foreign = Ingredient.objects.create(restaurant=other, name="Sel", unit="g")
        r = _set_recipe(owner_client, kitchen["burger"], [(foreign, 1)])
        assert r.status_code == 400

    def test_cost_is_computed_when_recipe_exists(self, owner_client, kitchen):
        _set_recipe(owner_client, kitchen["burger"], [(kitchen["pain"], 1)])
        # Une saisie manuelle du prix de revient est ignorée tant que la recette existe
        r = owner_client.patch(f"/api/v1/menus/items/{kitchen['burger'].id}/", {"cost_price": "99"}, format="json")
        assert r.status_code == 200 and Decimal(r.data["cost_price"]) == Decimal("0.40")
        # Le prix d'achat de l'ingrédient change → le prix de revient suit
        r = owner_client.patch(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/", {"unit_cost": "0.55"}, format="json")
        assert r.status_code == 200, r.data
        kitchen["burger"].refresh_from_db()
        assert kitchen["burger"].cost_price == Decimal("0.55")

    def test_public_does_not_see_recipe_or_cost(self, api_client, owner_client, kitchen):
        _set_recipe(owner_client, kitchen["burger"], [(kitchen["pain"], 1)])
        api_client.force_authenticate(None)     # visiteur anonyme
        r = api_client.get(f"/api/v1/menus/items/{kitchen['burger'].id}/")
        assert r.status_code == 200
        assert r.data["recipe"] is None and "cost_price" not in r.data and "limited_by" not in r.data
        assert r.data["effective_stock"] == 10 and r.data["is_low_stock"] is False


@pytest.mark.django_db
class TestConsumption:
    def test_sale_consumes_ingredients_and_cancel_restores(self, api_client, owner_client, client_user, restaurant, kitchen):
        _set_recipe(owner_client, kitchen["burger"], [(kitchen["pain"], 1), (kitchen["steak"], "0.15")])
        api_client.force_authenticate(client_user)
        today = timezone.localdate().isoformat()
        r = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter",
                                                 "pickup_slot": "23:59", "pickup_date": today,
                                                 "items": [{"menu_item_id": str(kitchen["burger"].id), "qty": 2}]}, format="json")
        assert r.status_code == 201, r.data
        kitchen["pain"].refresh_from_db(); kitchen["steak"].refresh_from_db()
        assert kitchen["pain"].stock_qty == 8
        assert kitchen["steak"].stock_qty == Decimal("0.900")
        assert IngredientMovement.objects.filter(reason="vente").count() == 2
        r = api_client.patch(f"/api/v1/orders/{r.data['id']}/cancel/", {}, format="json")
        assert r.status_code == 200
        kitchen["pain"].refresh_from_db(); kitchen["steak"].refresh_from_db()
        assert kitchen["pain"].stock_qty == 10 and kitchen["steak"].stock_qty == Decimal("1.200")
        assert IngredientMovement.objects.filter(reason="annulation").count() == 2

    def test_order_rejected_when_ingredient_is_short(self, api_client, owner_client, client_user, restaurant, kitchen):
        _set_recipe(owner_client, kitchen["burger"], [(kitchen["steak"], "0.15")])   # 8 portions
        api_client.force_authenticate(client_user)
        today = timezone.localdate().isoformat()
        r = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter",
                                                 "pickup_slot": "23:59", "pickup_date": today,
                                                 "items": [{"menu_item_id": str(kitchen["burger"].id), "qty": 9}]}, format="json")
        assert r.status_code == 400
        assert "limité par Steak haché" in str(r.data)

    def test_ingredient_out_disables_dishes_and_restock_reenables(self, owner_client, restaurant, kitchen):
        _set_recipe(owner_client, kitchen["burger"], [(kitchen["pain"], 1)])
        r = owner_client.post(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/waste/", {"qty": "10", "note": "moisis"}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["ingredient"]["stock_qty"] == "0.000"
        assert Decimal(r.data["movement"]["value"]) == Decimal("4.00")
        kitchen["burger"].refresh_from_db()
        assert kitchen["burger"].is_available is False and kitchen["burger"].auto_disabled is True
        r = owner_client.post(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/stock/", {"mode": "add", "qty": "30", "unit_cost": "0.45"}, format="json")
        assert r.status_code == 200 and r.data["movement"]["reason"] == "reappro"
        kitchen["burger"].refresh_from_db()
        assert kitchen["burger"].is_available is True and kitchen["burger"].cost_price == Decimal("0.45")
        # Alertes globales : rien à signaler maintenant
        r = owner_client.get(f"/api/v1/menus/items/stock-alerts/?restaurant={restaurant.id}")
        assert r.status_code == 200 and r.data["count"] == 0


@pytest.mark.django_db
class TestIngredientsApi:
    def test_create_with_initial_stock_traces_inventory(self, owner_client, restaurant, kitchen):
        r = owner_client.post("/api/v1/menus/ingredients/", {"restaurant": str(restaurant.id), "name": "Cheddar", "unit": "g",
                                                              "stock_qty": "500", "low_stock_threshold": "100", "unit_cost": "0.012"}, format="json")
        assert r.status_code == 201, r.data
        assert r.data["stock_qty"] == "500.000"
        assert IngredientMovement.objects.filter(ingredient_id=r.data["id"], reason="inventaire").count() == 1
        r = owner_client.get(f"/api/v1/menus/ingredients/?restaurant={restaurant.id}")
        assert r.data["count"] == 3

    def test_scoping_and_permissions(self, api_client, restaurant, kitchen, client_user):
        api_client.force_authenticate(client_user)
        assert api_client.get(f"/api/v1/menus/ingredients/?restaurant={restaurant.id}").data["count"] == 0
        r = api_client.post("/api/v1/menus/ingredients/", {"restaurant": str(restaurant.id), "name": "X", "unit": "g"}, format="json")
        assert r.status_code == 403
        assert api_client.get(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/").status_code == 404

    def test_delete_blocked_when_used_in_recipe(self, owner_client, kitchen):
        _set_recipe(owner_client, kitchen["burger"], [(kitchen["pain"], 1)])
        r = owner_client.delete(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/")
        assert r.status_code == 400 and "Burger" in str(r.data)
        _set_recipe(owner_client, kitchen["burger"], [])
        assert owner_client.delete(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/").status_code == 204

    def test_shopping_list_grouped_by_supplier(self, owner_client, restaurant, kitchen):
        owner_client.post(f"/api/v1/menus/ingredients/{kitchen['steak'].id}/stock/", {"mode": "set", "qty": "0.3"}, format="json")  # ≤ 0.5
        owner_client.post(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/stock/", {"mode": "set", "qty": "2"}, format="json")      # ≤ 4
        r = owner_client.get(f"/api/v1/menus/ingredients/shopping-list/?restaurant={restaurant.id}")
        assert r.status_code == 200, r.data
        assert r.data["count"] == 2
        groups = {(g["supplier"] or {}).get("name"): g for g in r.data["groups"]}
        steak_line = groups["Boucherie Dupont"]["lines"][0]
        assert Decimal(steak_line["qty"]) == Decimal("5") and Decimal(steak_line["cost"]) == Decimal("60.00")
        pain_line = groups[None]["lines"][0]
        assert Decimal(pain_line["qty"]) == Decimal("6")          # 2×seuil(4) − stock(2)
        r = owner_client.get(f"/api/v1/menus/ingredients/shopping-list/?restaurant={restaurant.id}&type=csv")
        assert r.status_code == 200 and "Boucherie Dupont" in r.content.decode("utf-8-sig")

    def test_suppliers_crud_and_movements(self, owner_client, restaurant, kitchen):
        r = owner_client.post("/api/v1/menus/suppliers/", {"restaurant": str(restaurant.id), "name": "Metro", "email": "contact@metro.be"}, format="json")
        assert r.status_code == 201, r.data
        r = owner_client.get(f"/api/v1/menus/suppliers/?restaurant={restaurant.id}")
        assert r.data["count"] == 2
        owner_client.post(f"/api/v1/menus/ingredients/{kitchen['pain'].id}/stock/", {"mode": "add", "qty": "5"}, format="json")
        r = owner_client.get(f"/api/v1/menus/ingredient-movements/?restaurant={restaurant.id}")
        assert r.status_code == 200 and r.data["count"] == 1 and r.data["results"][0]["ingredient_name"] == "Pain burger"

    def test_stock_digest_lists_ingredients(self, owner_client, restaurant, kitchen, capsys):
        from django.core.management import call_command
        owner_client.post(f"/api/v1/menus/ingredients/{kitchen['steak'].id}/stock/", {"mode": "set", "qty": "0"}, format="json")
        call_command("stock_digest", "--dry-run")
        out = capsys.readouterr().out
        assert "Steak haché" in out and "Boucherie Dupont" in out
