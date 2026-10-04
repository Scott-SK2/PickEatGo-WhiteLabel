"""Tests favoris, réponse aux avis, liste des avis du restaurateur."""
import pytest
from decimal import Decimal
from django.utils import timezone
from apps.menus.models import Category, MenuItem
from apps.restaurants.models import Favorite


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"))


@pytest.fixture
def rated_order(api_client, client_user, restaurant, dish):
    api_client.force_authenticate(client_user)
    o = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                             "pickup_date": timezone.localdate().isoformat(),
                                             "items": [{"menu_item_id": str(dish.id), "qty": 1}]}, format="json").data
    api_client.force_authenticate(restaurant.owner)
    for _ in range(4):
        api_client.patch(f"/api/v1/orders/{o['id']}/advance/", {}, format="json")
    api_client.force_authenticate(client_user)
    r = api_client.post(f"/api/v1/orders/{o['id']}/rate/", {"rating": 4, "comment": "Très bon burger"}, format="json")
    assert r.status_code == 200
    return o


@pytest.mark.django_db
class TestFavorites:
    def test_toggle_and_list(self, api_client, client_user, restaurant):
        api_client.force_authenticate(client_user)
        assert api_client.post(f"/api/v1/restaurants/{restaurant.id}/favorite/").data["is_favorite"] is True
        assert api_client.get("/api/v1/restaurants/favorites/").data["restaurants"] == [str(restaurant.id)]
        assert api_client.post(f"/api/v1/restaurants/{restaurant.id}/favorite/").data["is_favorite"] is False
        assert Favorite.objects.count() == 0

    def test_requires_auth(self, api_client, restaurant):
        assert api_client.post(f"/api/v1/restaurants/{restaurant.id}/favorite/").status_code == 401


@pytest.mark.django_db
class TestReviews:
    def test_owner_reply_is_public(self, api_client, client_user, restaurant, rated_order):
        api_client.force_authenticate(client_user)
        assert api_client.post(f"/api/v1/orders/{rated_order['id']}/reply/", {"reply": "x"}, format="json").status_code == 403
        api_client.force_authenticate(restaurant.owner)
        r = api_client.get(f"/api/v1/orders/reviews/?restaurant={restaurant.id}")
        assert r.status_code == 200 and r.data["count"] == 1 and r.data["unanswered"] == 1 and r.data["average"] == 4
        r = api_client.post(f"/api/v1/orders/{rated_order['id']}/reply/", {"reply": "Merci Jean !"}, format="json")
        assert r.status_code == 200 and r.data["owner_reply"] == "Merci Jean !"
        api_client.force_authenticate(None)
        pub = api_client.get(f"/api/v1/restaurants/{restaurant.id}/reviews/").data
        assert pub[0]["owner_reply"] == "Merci Jean !" and pub[0]["rating"] == 4
        api_client.force_authenticate(restaurant.owner)
        assert api_client.get(f"/api/v1/orders/reviews/?restaurant={restaurant.id}").data["unanswered"] == 0
