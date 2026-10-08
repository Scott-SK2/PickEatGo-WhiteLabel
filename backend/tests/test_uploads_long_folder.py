"""
Photos de plat et du lieu avec un dossier Cloudinary long (instance marque blanche : CLOUDINARY_FOLDER=pickeatgo-<slug>).
L'identifiant « dossier/menus/<restaurant>/<plat>-xxxxxxxx » dépasse 100 caractères : les colonnes image doivent accepter 255.
"""
import pytest
from decimal import Decimal
from io import BytesIO
from PIL import Image
from apps.menus.models import Category, MenuItem


def _img(name="p.jpg"):
    buf = BytesIO(); Image.new("RGB", (40, 40), (200, 80, 30)).save(buf, "JPEG"); buf.seek(0); buf.name = name
    return buf


@pytest.mark.django_db
def test_uploads_with_long_cloudinary_folder(api_client, restaurant, monkeypatch, settings):
    settings.CLOUDINARY_STORAGE = {**settings.CLOUDINARY_STORAGE, "CLOUD_NAME": "demo", "API_KEY": "k", "API_SECRET": "s", "PREFIX": "pickeatgo-un-nom-de-restaurant-assez-long"}
    import apps.menus.views as mv
    monkeypatch.setattr(mv, "cloudinary_upload", lambda file, folder, public_id: f"{settings.CLOUDINARY_STORAGE['PREFIX']}/{folder}/{public_id}")
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    dish = MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"))
    api_client.force_authenticate(restaurant.owner)
    r = api_client.post(f"/api/v1/menus/items/{dish.id}/upload-image/", {"image": _img()}, format="multipart")
    assert r.status_code == 200, getattr(r, "data", r.content)
    assert r.data["image_url"].startswith("https://res.cloudinary.com/demo/") and len(r.data["image_url"]) > 140
    r = api_client.post(f"/api/v1/restaurants/{restaurant.id}/photos/", {"image": _img("g.jpg"), "caption": "x"}, format="multipart")
    assert r.status_code == 200, getattr(r, "data", r.content)
    r = api_client.post(f"/api/v1/menus/items/{dish.id}/photos/", {"image": _img("h.jpg")}, format="multipart")
    assert r.status_code == 200, getattr(r, "data", r.content)
