"""
tests/test_orders.py — Tests anti-régression commandes
tests/test_menus.py  — Tests anti-régression menus + upload photo
"""
# ──────────────────────────────────────────────────────────────────────────────
# conftest.py (à placer à la racine du projet)
# ──────────────────────────────────────────────────────────────────────────────
# import pytest
# from rest_framework.test import APIClient
# from apps.accounts.models import User
# from apps.restaurants.models import Restaurant
#
# @pytest.fixture
# def api_client():
#     return APIClient()
#
# @pytest.fixture
# def client_user(db):
#     return User.objects.create_user(email="client@test.com", password="pass1234",
#                                      first_name="Jean", last_name="Dupont", role="client")
#
# @pytest.fixture
# def restaurateur_user(db):
#     return User.objects.create_user(email="resto@test.com", password="pass1234",
#                                      first_name="Marco", last_name="Rossi", role="restaurateur")
#
# @pytest.fixture
# def restaurant(db, restaurateur_user):
#     return Restaurant.objects.create(
#         owner=restaurateur_user, name="Test Burger", cuisine="Américain",
#         address="1 Rue Test", phone="0123456789", status="active", is_open=True
#     )

import pytest
from django.utils import timezone
from django.urls import reverse
from rest_framework import status
from io import BytesIO
from PIL import Image


# ═══════════════════════════════════════════════════════════════════════════
# TESTS AUTH
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.django_db
class TestAuth:
    def test_register_client(self, api_client):
        url  = reverse("auth-register")
        data = {
            "email": "newuser@test.com", "first_name": "Alice",
            "last_name": "Martin", "role": "client", "phone": "+32 470 00 00 00",
            "password": "Secure1234!", "password2": "Secure1234!",
        }
        response = api_client.post(url, data)
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert "access" in response.data
        assert "refresh" in response.data
        assert response.data["user"]["role"] == "client"

    def test_register_password_mismatch(self, api_client):
        url  = reverse("auth-register")
        data = {
            "email": "x@test.com", "first_name": "X", "last_name": "Y",
            "password": "Secure1234!", "password2": "Different!"
        }
        response = api_client.post(url, data)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_login(self, api_client, client_user):
        url  = reverse("auth-login")
        data = {"email": "client@test.com", "password": "pass1234"}
        response = api_client.post(url, data)
        assert response.status_code == status.HTTP_200_OK
        assert "access" in response.data
        assert response.data["user"]["role"] == "client"

    def test_me_requires_auth(self, api_client):
        url = reverse("auth-me")
        assert api_client.get(url).status_code == status.HTTP_401_UNAUTHORIZED

    def test_me_returns_user(self, api_client, client_user):
        api_client.force_authenticate(user=client_user)
        response = api_client.get(reverse("auth-me"))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["email"] == client_user.email


# ═══════════════════════════════════════════════════════════════════════════
# TESTS RESTAURANTS
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.django_db
class TestRestaurants:
    def test_list_public(self, api_client, restaurant):
        url      = reverse("restaurant-list")
        response = api_client.get(url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] >= 1

    def test_filter_by_cuisine(self, api_client, restaurant):
        url      = reverse("restaurant-list")
        response = api_client.get(url, {"cuisine": "Américain"})
        assert response.status_code == status.HTTP_200_OK

    def test_validate_requires_admin(self, api_client, restaurant, client_user):
        api_client.force_authenticate(user=client_user)
        url      = reverse("restaurant-validate-restaurant", args=[restaurant.id])
        response = api_client.patch(url)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ═══════════════════════════════════════════════════════════════════════════
# TESTS MENUS — UPLOAD PHOTO
# ═══════════════════════════════════════════════════════════════════════════
def _make_image(fmt="JPEG", size=(100, 100), file_size_kb=100) -> BytesIO:
    """Crée une image en mémoire pour les tests d'upload"""
    buf = BytesIO()
    img = Image.new("RGB", size, color=(255, 100, 50))
    img.save(buf, format=fmt)
    buf.seek(0)
    buf.name = f"test.{'jpg' if fmt == 'JPEG' else fmt.lower()}"
    return buf


@pytest.mark.django_db
class TestMenuItemPhotoUpload:
    def _create_category_and_item(self, restaurant, name="Burger Test", price="9.50"):
        from apps.menus.models import Category, MenuItem
        cat  = Category.objects.create(restaurant=restaurant, name="Burgers", order=0)
        item = MenuItem.objects.create(category=cat, name=name, price=price,
                                       description="Un délicieux burger")
        return cat, item

    def test_upload_jpeg(self, api_client, restaurateur_user, restaurant):
        _, item = self._create_category_and_item(restaurant)
        api_client.force_authenticate(user=restaurateur_user)
        url    = reverse("menuitem-upload-image", args=[item.id])
        image  = _make_image("JPEG")
        response = api_client.post(url, {"image": image}, format="multipart")
        assert response.status_code == status.HTTP_200_OK
        assert "image_url" in response.data

    def test_upload_png(self, api_client, restaurateur_user, restaurant):
        _, item = self._create_category_and_item(restaurant)
        api_client.force_authenticate(user=restaurateur_user)
        url    = reverse("menuitem-upload-image", args=[item.id])
        image  = _make_image("PNG")
        response = api_client.post(url, {"image": image}, format="multipart")
        assert response.status_code == status.HTTP_200_OK

    def test_upload_too_large(self, api_client, restaurateur_user, restaurant):
        """Fichier > 5MB doit être rejeté"""
        _, item  = self._create_category_and_item(restaurant)
        api_client.force_authenticate(user=restaurateur_user)
        url     = reverse("menuitem-upload-image", args=[item.id])
        # Simule un gros fichier (mock la taille)
        image   = _make_image("JPEG")
        image.size_override = 6 * 1024 * 1024  # 6 MB
        # En vrai test, utiliser un mock ou SimpleUploadedFile avec size fixé
        # Ici on vérifie que la validation existe bien dans le serializer
        from apps.menus.serializers import MenuItemSerializer
        from django.core.files.uploadedfile import SimpleUploadedFile
        big_file = SimpleUploadedFile("big.jpg", b"x" * (6 * 1024 * 1024), content_type="image/jpeg")
        response = api_client.post(url, {"image": big_file}, format="multipart")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_upload_requires_auth(self, api_client, restaurant):
        _, item = self._create_category_and_item(restaurant)
        url     = reverse("menuitem-upload-image", args=[item.id])
        response = api_client.post(url, {"image": _make_image()}, format="multipart")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_delete_image(self, api_client, restaurateur_user, restaurant):
        _, item = self._create_category_and_item(restaurant)
        api_client.force_authenticate(user=restaurateur_user)
        url      = reverse("menuitem-delete-image", args=[item.id])
        response = api_client.delete(url)
        assert response.status_code == status.HTTP_200_OK

    def test_toggle_availability(self, api_client, restaurateur_user, restaurant):
        _, item = self._create_category_and_item(restaurant)
        assert item.is_available is True
        api_client.force_authenticate(user=restaurateur_user)
        url      = reverse("menuitem-toggle-availability", args=[item.id])
        response = api_client.patch(url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["is_available"] is False


# ═══════════════════════════════════════════════════════════════════════════
# TESTS COMMANDES
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.django_db
class TestOrders:
    def _make_order(self, api_client, client_user, restaurant):
        from apps.menus.models import Category, MenuItem
        cat  = Category.objects.create(restaurant=restaurant, name="Burgers", order=0)
        item = MenuItem.objects.create(category=cat, name="Burger Classic",
                                       price="9.50", is_available=True)
        api_client.force_authenticate(user=client_user)
        url  = reverse("order-list")
        data = {
            "restaurant":  str(restaurant.id),
            "order_type":  "emporter",
            "pickup_slot": "23:59",
            "pickup_date": timezone.localdate().isoformat(),
            "note":        "",
            "items":       [{"menu_item_id": str(item.id), "qty": 2, "options": []}],
        }
        return api_client.post(url, data, format="json")

    def test_create_order(self, api_client, client_user, restaurant):
        response = self._make_order(api_client, client_user, restaurant)
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == "nouvelle"
        assert response.data["total_price"] == "19.00"

    def test_order_only_visible_to_owner(self, api_client, client_user, restaurateur_user, restaurant):
        self._make_order(api_client, client_user, restaurant)
        # Un autre client ne voit pas la commande
        other = __import__("apps.accounts.models", fromlist=["User"]).User.objects.create_user(
            email="other@test.com", password="pass1234",
            first_name="Other", last_name="User", role="client"
        )
        api_client.force_authenticate(user=other)
        response = api_client.get(reverse("order-list"))
        assert response.data["count"] == 0

    def test_advance_order(self, api_client, client_user, restaurateur_user, restaurant):
        r = self._make_order(api_client, client_user, restaurant)
        order_id = r.data["id"]
        api_client.force_authenticate(user=restaurateur_user)
        url      = reverse("order-advance", args=[order_id])
        response = api_client.patch(url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["status"] == "confirmee"

    def test_cancel_order(self, api_client, client_user, restaurant):
        r        = self._make_order(api_client, client_user, restaurant)
        order_id = r.data["id"]
        url      = reverse("order-cancel", args=[order_id])
        response = api_client.patch(url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["status"] == "annulee"

    def test_create_order_closed_restaurant(self, api_client, client_user, restaurant):
        restaurant.is_open = False
        restaurant.save()
        response = self._make_order(api_client, client_user, restaurant)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
