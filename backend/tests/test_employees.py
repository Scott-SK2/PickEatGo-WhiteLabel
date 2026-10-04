"""
Tests des comptes employés : PIN haché, déverrouillage, traçabilité des ventes.
"""
import pytest
from decimal import Decimal
from django.utils import timezone

from apps.menus.models import Category, MenuItem
from apps.orders.models import Order
from apps.restaurants.models import Employee


@pytest.fixture
def owner_client(api_client, restaurateur_user):
    api_client.force_authenticate(restaurateur_user)
    return api_client


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"))


def _create(client, restaurant, name="Sarah", role="caissier", pin="4826"):
    return client.post("/api/v1/restaurants/employees/", {"restaurant": str(restaurant.id), "name": name, "role": role, "pin": pin}, format="json")


@pytest.mark.django_db
class TestEmployees:
    def test_create_hashes_pin_and_rejects_weak_or_duplicate(self, owner_client, restaurant):
        r = _create(owner_client, restaurant)
        assert r.status_code == 201, r.data
        assert "pin" not in r.data and "pin_hash" not in r.data
        emp = Employee.objects.get(pk=r.data["id"])
        assert emp.pin_hash != "4826" and emp.check_pin("4826")
        assert _create(owner_client, restaurant, name="Tom", pin="1234").status_code == 400     # trop évident
        assert _create(owner_client, restaurant, name="Tom", pin="4826").status_code == 400     # déjà utilisé
        assert _create(owner_client, restaurant, name="Tom", pin="ab12").status_code == 400     # pas numérique

    def test_unlock_identifies_employee_and_exit_requires_manager(self, owner_client, restaurant):
        _create(owner_client, restaurant, name="Sarah", role="caissier", pin="4826")
        r = owner_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": "4826"}, format="json")
        assert r.status_code == 200 and r.data["employee"]["name"] == "Sarah" and r.data["locked"] is True
        r = owner_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": "9999"}, format="json")
        assert r.status_code == 400
        # Aucun gérant : la sortie du mode caissier n'est pas verrouillée
        r = owner_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": "", "purpose": "exit"}, format="json")
        assert r.status_code == 200 and r.data["locked"] is False
        _create(owner_client, restaurant, name="Marco", role="gerant", pin="7391")
        r = owner_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": "4826", "purpose": "exit"}, format="json")
        assert r.status_code == 400                       # un caissier ne peut pas déverrouiller la sortie
        r = owner_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": "7391", "purpose": "exit"}, format="json")
        assert r.status_code == 200 and r.data["employee"]["role"] == "gerant"

    def test_no_employee_means_no_lock(self, owner_client, restaurant):
        r = owner_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": ""}, format="json")
        assert r.status_code == 200 and r.data["employee"] is None and r.data["locked"] is False

    def test_scoped_to_owner(self, api_client, owner_client, restaurant, client_user):
        _create(owner_client, restaurant)
        api_client.force_authenticate(client_user)
        assert api_client.get(f"/api/v1/restaurants/employees/?restaurant={restaurant.id}").data["count"] == 0
        assert _create(api_client, restaurant, name="Pirate", pin="5566").status_code == 403
        r = api_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": "4826"}, format="json")
        assert r.status_code == 403

    def test_update_pin_and_deactivate(self, owner_client, restaurant):
        eid = _create(owner_client, restaurant).data["id"]
        r = owner_client.patch(f"/api/v1/restaurants/employees/{eid}/", {"pin": "6060", "is_active": False}, format="json")
        assert r.status_code == 200, r.data
        emp = Employee.objects.get(pk=eid)
        assert emp.check_pin("6060") and emp.is_active is False
        r = owner_client.post("/api/v1/restaurants/employees/unlock/", {"restaurant": str(restaurant.id), "pin": "6060"}, format="json")
        assert r.data["locked"] is False                  # plus aucun employé actif

    def test_counter_sale_and_pickup_record_employee(self, api_client, owner_client, restaurant, dish, client_user):
        eid = _create(owner_client, restaurant).data["id"]
        r = owner_client.post("/api/v1/orders/counter/", {"restaurant": str(restaurant.id), "payment_method": "carte", "employee": eid,
                                                          "items": [{"menu_item_id": str(dish.id), "qty": 1}]}, format="json")
        assert r.status_code == 201, r.data
        assert r.data["employee_name"] == "Sarah"
        # Employé d'un autre restaurant → refusé
        r = owner_client.post("/api/v1/orders/counter/", {"restaurant": str(restaurant.id), "payment_method": "carte", "employee": str(client_user.id),
                                                          "items": [{"menu_item_id": str(dish.id), "qty": 1}]}, format="json")
        assert r.status_code == 400
        # Remise d'une commande en ligne par l'employé
        api_client.force_authenticate(client_user)
        o = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                                 "pickup_date": timezone.localdate().isoformat(),
                                                 "items": [{"menu_item_id": str(dish.id), "qty": 1}]}, format="json").data
        owner_client.force_authenticate(restaurant.owner)
        for _ in range(3):
            owner_client.patch(f"/api/v1/orders/{o['id']}/advance/", {}, format="json")
        r = owner_client.patch(f"/api/v1/orders/{o['id']}/advance/", {"payment_method": "especes", "employee": eid}, format="json")
        assert r.status_code == 200
        assert Order.objects.get(pk=o["id"]).employee_id.hex == eid.replace("-", "")
        # Rapport : ventes par employé
        r = owner_client.get(f"/api/v1/orders/sales/?restaurant={restaurant.id}")
        emp = {e["name"]: e for e in r.data["by_employee"]}
        assert emp["Sarah"]["orders"] == 2 and Decimal(emp["Sarah"]["revenue"]) == Decimal("19.00")


@pytest.mark.django_db
class TestRestaurantWriteAccess:
    def test_only_owner_can_update_and_contract_is_admin_only(self, api_client, owner_client, restaurant, client_user):
        r = owner_client.patch(f"/api/v1/restaurants/{restaurant.id}/", {"receipt_footer": "Merci !", "commission_pct": "0.00"}, format="json")
        assert r.status_code == 200, r.data
        restaurant.refresh_from_db()
        assert restaurant.receipt_footer == "Merci !" and restaurant.commission_pct == Decimal("5.00")   # contrat ignoré
        api_client.force_authenticate(client_user)
        assert api_client.patch(f"/api/v1/restaurants/{restaurant.id}/", {"name": "Piraté"}, format="json").status_code == 403
        assert api_client.delete(f"/api/v1/restaurants/{restaurant.id}/").status_code == 403
