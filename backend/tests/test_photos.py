"""Tests de la galerie photos des plats (5 max, suppression, photo principale)."""
import pytest
from decimal import Decimal
from io import BytesIO
from PIL import Image
from apps.menus.models import Category, MenuItem, MenuItemPhoto


def _img(name="p.jpg"):
    buf = BytesIO(); Image.new("RGB", (40, 40), (200, 80, 30)).save(buf, "JPEG"); buf.seek(0); buf.name = name
    return buf


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"))


@pytest.mark.django_db
class TestPhotos:
    def test_gallery_limit_delete_and_cover(self, api_client, restaurant, dish, client_user):
        api_client.force_authenticate(restaurant.owner)
        url = f"/api/v1/menus/items/{dish.id}/photos/"
        # 1re photo sans principale → devient la principale
        r = api_client.post(url, {"image": _img("a.jpg")}, format="multipart")
        assert r.status_code == 200, r.data
        assert r.data["item"]["image_url"] and r.data["item"]["photos"] == []
        for n in range(4):
            r = api_client.post(url, {"image": _img(f"b{n}.jpg")}, format="multipart")
            assert r.status_code == 200, r.data
        assert len(r.data["item"]["image_urls"]) == 5 and len(r.data["item"]["photos"]) == 4
        assert api_client.post(url, {"image": _img("z.jpg")}, format="multipart").status_code == 400     # 6e refusée
        # Photo principale : échange avec une secondaire
        photo_id = r.data["item"]["photos"][0]["id"]
        old_cover = r.data["item"]["image_url"]
        r = api_client.post(f"{url}{photo_id}/")
        assert r.status_code == 200 and r.data["item"]["image_url"] != old_cover
        assert len(r.data["item"]["image_urls"]) == 5
        # Suppression
        r = api_client.delete(f"{url}{photo_id}/")
        assert r.status_code == 200 and len(r.data["item"]["photos"]) == 3
        assert MenuItemPhoto.objects.filter(item=dish).count() == 3
        # Le public voit les URLs de la galerie
        api_client.force_authenticate(None)
        r = api_client.get(f"/api/v1/menus/items/{dish.id}/")
        assert len(r.data["image_urls"]) == 4
        # Un autre utilisateur ne peut pas ajouter
        api_client.force_authenticate(client_user)
        assert api_client.post(url, {"image": _img("x.jpg")}, format="multipart").status_code == 403
