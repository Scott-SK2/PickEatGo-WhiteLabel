"""Tests de la galerie du restaurant (photos du lieu, bannière, légende)."""
import pytest
from io import BytesIO
from PIL import Image
from apps.restaurants.models import RestaurantPhoto


def _img(name="p.jpg"):
    buf = BytesIO(); Image.new("RGB", (40, 40), (30, 80, 200)).save(buf, "JPEG"); buf.seek(0); buf.name = name
    return buf


@pytest.mark.django_db
class TestRestaurantGallery:
    def test_add_caption_banner_delete(self, api_client, restaurant, client_user):
        url = f"/api/v1/restaurants/{restaurant.id}/photos/"
        api_client.force_authenticate(client_user)
        assert api_client.post(url, {"image": _img()}, format="multipart").status_code == 403
        api_client.force_authenticate(restaurant.owner)
        r = api_client.post(url, {"image": _img("facade.jpg"), "caption": "Façade"}, format="multipart")
        assert r.status_code == 200, r.data
        g = r.data["restaurant"]["gallery"]
        assert len(g) == 1 and g[0]["caption"] == "Façade" and g[0]["url"]
        assert r.data["restaurant"]["banner_url"]                       # première photo → bannière
        r = api_client.post(url, {"image": _img("salle.jpg")}, format="multipart")
        pid = r.data["restaurant"]["gallery"][1]["id"]
        r = api_client.patch(f"{url}{pid}/", {"caption": "Salle"}, format="json")
        assert r.data["restaurant"]["gallery"][1]["caption"] == "Salle"
        old_banner = r.data["restaurant"]["banner_url"]
        r = api_client.post(f"{url}{pid}/")
        assert r.data["restaurant"]["banner_url"] != old_banner
        r = api_client.delete(f"{url}{pid}/")
        assert r.status_code == 200 and len(r.data["restaurant"]["gallery"]) == 1 and r.data["restaurant"]["banner_url"] is None
        assert RestaurantPhoto.objects.count() == 1
        # Public
        api_client.force_authenticate(None)
        r = api_client.get(f"/api/v1/restaurants/{restaurant.id}/")
        assert len(r.data["gallery"]) == 1
