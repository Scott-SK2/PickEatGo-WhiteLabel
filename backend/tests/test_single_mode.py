"""
Édition Marque Blanche — mode mono-restaurant (APP_MODE=single) et marque de l'application.
Scénarios de recette R1, R6, R7, R8, R9 du cahier des charges, côté API.
"""
from decimal import Decimal
from io import BytesIO

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from PIL import Image

from apps.accounts.models import User
from apps.menus.models import Category, MenuItem
from apps.notifications import push as push_service
from apps.restaurants.models import BusinessHours, Restaurant
from apps.tenant.models import Branding


def _png(size=(300, 200), color=(255, 107, 44)):
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    buf.seek(0)
    buf.name = "logo.png"
    return buf


@pytest.fixture
def other_restaurant(db):
    owner = User.objects.create_user(email="other@test.com", password="pass1234", first_name="O", last_name="W", role=User.RESTAURATEUR)
    r = Restaurant.objects.create(owner=owner, name="Autre Resto", slug="autre", address="a", city="b", phone="0", status=Restaurant.ACTIVE, is_open=True)
    cat = Category.objects.create(restaurant=r, name="Plats")
    MenuItem.objects.create(category=cat, name="Pizza", price=Decimal("8.00"))
    return r


@pytest.fixture
def dish(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats")
    return MenuItem.objects.create(category=cat, name="Burger", price=Decimal("10.00"))


# ═══════════════════════════════════════════════════════════════════════════
# GET /branding/ : contrat public
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.django_db
class TestBrandingEndpoint:
    def test_platform_mode_payload(self, api_client, settings):
        settings.APP_MODE = "platform"
        r = api_client.get("/api/v1/branding/")
        assert r.status_code == 200
        assert r.data["mode"] == "platform" and r.data["restaurant"] is None
        assert r.data["brand"]["app_name"] == "PickEatGo" and r.data["powered_by_badge"] is False

    def test_single_mode_payload(self, api_client, single_mode, dish):
        r = api_client.get("/api/v1/branding/")
        assert r.status_code == 200 and r["Cache-Control"] == "public, max-age=60"
        d = r.data
        assert d["mode"] == "single" and d["configured"] is True and d["timezone"] == "Europe/Brussels"
        assert d["restaurant"]["id"] == str(single_mode.id) and d["restaurant"]["status"] == "active"
        assert "owner_email" not in d["restaurant"] and "commission_pct" not in d["restaurant"]
        assert d["restaurant"]["categories"][0]["items"][0]["name"] == "Burger"      # carte préchargée
        assert d["brand"]["app_name"] == "Test Burger" and d["brand"]["short_name"] == "Test Burger"
        assert d["brand"]["theme_color"] == "#FF6B2C" and d["powered_by_badge"] is True
        assert d["publication"]["ready"] is False and "Mentions légales, conditions et confidentialité renseignées" in d["publication"]["missing"]
        assert Branding.objects.filter(restaurant=single_mode).exists()           # créée à la volée avec les défauts

    def test_single_mode_unconfigured(self, api_client, settings):
        settings.APP_MODE = "single"; settings.TENANT_RESTAURANT_ID = None
        d = api_client.get("/api/v1/branding/").data
        assert d["configured"] is False and d["restaurant"] is None
        assert api_client.get("/api/v1/restaurants/").data["count"] == 0

    def test_cache_invalidated_on_restaurant_change(self, api_client, single_mode):
        assert api_client.get("/api/v1/branding/").data["restaurant"]["is_open"] is True
        single_mode.is_open = False; single_mode.save()
        assert api_client.get("/api/v1/branding/").data["restaurant"]["is_open"] is False

    def test_patch_requires_owner(self, api_client, single_mode, client_user, restaurateur_user, admin_user):
        assert api_client.patch("/api/v1/branding/", {"app_name": "X"}, format="json").status_code == 401
        api_client.force_authenticate(client_user)
        assert api_client.patch("/api/v1/branding/", {"app_name": "X"}, format="json").status_code == 403
        api_client.force_authenticate(restaurateur_user)
        r = api_client.patch("/api/v1/branding/", {"app_name": "Burger House", "short_name": "Burger", "tagline": "Le vrai goût",
                                                   "social_links": {"instagram": "instagram.com/burgerhouse", "facebook": ""}}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["brand"]["app_name"] == "Burger House" and r.data["brand"]["social_links"] == {"instagram": "https://instagram.com/burgerhouse"}
        api_client.force_authenticate(admin_user)
        assert api_client.patch("/api/v1/branding/", {"publisher": "M. Rossi"}, format="json").data["brand"]["publisher"] == "M. Rossi"
        # Visible immédiatement par le public (R8)
        api_client.force_authenticate(None)
        assert api_client.get("/api/v1/branding/").data["brand"]["app_name"] == "Burger House"

    def test_patch_validation(self, api_client, single_mode, restaurateur_user):
        api_client.force_authenticate(restaurateur_user)
        assert api_client.patch("/api/v1/branding/", {"app_name": "x" * 41}, format="json").status_code == 400
        assert api_client.patch("/api/v1/branding/", {"short_name": "beaucoup trop long"}, format="json").status_code == 400
        assert api_client.patch("/api/v1/branding/", {"social_links": {"twitter": "https://x.com"}}, format="json").status_code == 400
        assert api_client.patch("/api/v1/branding/", {"social_links": {"website": "pas une url du tout !"}}, format="json").status_code == 400
        assert api_client.patch("/api/v1/branding/", {"app_name": ""}, format="json").status_code == 400
        r = api_client.patch("/api/v1/branding/", {"theme_color": "#000000"}, format="json")
        assert r.status_code == 200 and r.data["brand"]["theme_color"] == "#FF6B2C"     # couleur fixée dans cette version

    def test_branding_patch_unavailable_in_platform_mode(self, api_client, restaurateur_user, restaurant, settings):
        settings.APP_MODE = "platform"
        api_client.force_authenticate(restaurateur_user)
        assert api_client.patch("/api/v1/branding/", {"app_name": "X"}, format="json").status_code == 404


@pytest.mark.django_db
class TestBrandingIcons:
    def test_upload_generates_three_icons(self, api_client, single_mode, restaurateur_user):
        api_client.force_authenticate(restaurateur_user)
        r = api_client.post("/api/v1/branding/icons/", {"image": _png()}, format="multipart")
        assert r.status_code == 200, r.data
        b = Branding.objects.get(restaurant=single_mode)
        for field, size in (("icon_192", 192), ("icon_512", 512), ("icon_maskable", 512)):
            f = getattr(b, field)
            assert f, field
            with f.open("rb") as fh:
                img = Image.open(fh)
                assert img.size == (size, size) and img.format == "PNG"
        assert r.data["brand"]["icon_192_url"] and r.data["brand"]["icon_maskable_url"]
        assert any(i["key"] == "icons" and i["ok"] for i in r.data["publication"]["items"])

    def test_generate_from_logo(self, api_client, single_mode, restaurateur_user):
        api_client.force_authenticate(restaurateur_user)
        assert api_client.post("/api/v1/branding/icons/", {"source": "logo"}, format="multipart").status_code == 400   # pas de logo
        assert api_client.post(f"/api/v1/restaurants/{single_mode.id}/upload-logo/", {"logo": _png((400, 400))}, format="multipart").status_code == 200
        r = api_client.post("/api/v1/branding/icons/", {"source": "logo"}, format="multipart")
        assert r.status_code == 200, r.data
        assert r.data["brand"]["icon_512_url"]

    def test_share_image_and_errors(self, api_client, single_mode, restaurateur_user, client_user):
        api_client.force_authenticate(client_user)
        assert api_client.post("/api/v1/branding/icons/", {"image": _png()}, format="multipart").status_code == 403
        api_client.force_authenticate(restaurateur_user)
        assert api_client.post("/api/v1/branding/icons/", {}, format="multipart").status_code == 400
        r = api_client.post("/api/v1/branding/icons/", {"image": _png((1600, 900)), "kind": "share"}, format="multipart")
        assert r.status_code == 200
        with Branding.objects.get(restaurant=single_mode).share_image.open("rb") as fh:
            assert Image.open(fh).size == (1200, 630)


# ═══════════════════════════════════════════════════════════════════════════
# Règles du mode mono-restaurant
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.django_db
class TestSingleModeRules:
    def test_only_tenant_restaurant_is_visible(self, api_client, single_mode, other_restaurant):
        """R1 / R7 : la liste ne contient que le restaurant lié ; un autre identifiant répond 404."""
        r = api_client.get("/api/v1/restaurants/")
        assert r.data["count"] == 1 and r.data["results"][0]["id"] == str(single_mode.id)
        assert api_client.get(f"/api/v1/restaurants/{other_restaurant.id}/").status_code == 404
        assert api_client.get(f"/api/v1/restaurants/{single_mode.id}/").status_code == 200
        assert api_client.get(f"/api/v1/menus/items/?restaurant={other_restaurant.id}").data["count"] == 0
        assert api_client.get(f"/api/v1/menus/categories/?restaurant={other_restaurant.id}").data["count"] == 0

    def test_admin_sees_only_tenant(self, api_client, single_mode, other_restaurant, admin_user):
        api_client.force_authenticate(admin_user)
        assert api_client.get("/api/v1/restaurants/").data["count"] == 1
        assert api_client.get(f"/api/v1/restaurants/{other_restaurant.id}/").status_code == 404
        assert api_client.get(f"/api/v1/orders/sales/?restaurant={other_restaurant.id}").status_code == 403
        assert api_client.get(f"/api/v1/orders/loyalty/?restaurant={other_restaurant.id}").status_code == 404

    def test_register_restaurateur_refused(self, api_client, single_mode):
        """R6 : l'inscription publique ne crée que des clients."""
        body = {"email": "new@test.com", "password": "Secret1234!", "password2": "Secret1234!", "first_name": "A", "last_name": "B", "phone": "0470"}
        assert api_client.post("/api/v1/auth/register/", {**body, "role": "restaurateur"}, format="json").status_code == 400
        assert not User.objects.filter(email="new@test.com").exists()
        r = api_client.post("/api/v1/auth/register/", {**body, "role": "client"}, format="json")
        assert r.status_code == 201 and r.data["user"]["role"] == "client"

    def test_create_restaurant_refused(self, api_client, single_mode, restaurateur_user, admin_user):
        """R6 : POST /restaurants/ répond 403, aucun restaurant créé."""
        for u in (restaurateur_user, admin_user):
            api_client.force_authenticate(u)
            r = api_client.post("/api/v1/restaurants/", {"name": "Deuxième", "address": "x", "city": "y", "phone": "0"}, format="json")
            assert r.status_code == 403, r.data
        assert Restaurant.objects.count() == 1

    def test_validate_suspend_contract_disabled(self, api_client, single_mode, admin_user):
        api_client.force_authenticate(admin_user)
        assert api_client.patch(f"/api/v1/restaurants/{single_mode.id}/validate/").status_code == 403
        assert api_client.patch(f"/api/v1/restaurants/{single_mode.id}/suspend/").status_code == 403
        assert api_client.get(f"/api/v1/restaurants/{single_mode.id}/contract/").status_code == 403
        assert api_client.delete(f"/api/v1/restaurants/{single_mode.id}/").status_code == 403
        single_mode.refresh_from_db()
        assert single_mode.status == Restaurant.ACTIVE

    def test_status_always_active_in_api(self, api_client, single_mode):
        Restaurant.objects.filter(pk=single_mode.pk).update(status=Restaurant.PENDING)
        r = api_client.get(f"/api/v1/restaurants/{single_mode.id}/")
        assert r.status_code == 200 and r.data["status"] == "active"

    def test_order_on_other_restaurant_refused(self, api_client, single_mode, other_restaurant, client_user):
        api_client.force_authenticate(client_user)
        pizza = MenuItem.objects.get(name="Pizza")
        r = api_client.post("/api/v1/orders/", {"restaurant": str(other_restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                                 "pickup_date": timezone.localdate().isoformat(), "items": [{"menu_item_id": str(pizza.id), "qty": 1}]}, format="json")
        assert r.status_code == 400
        assert api_client.post("/api/v1/orders/delivery/quote/", {"restaurant": str(other_restaurant.id), "postcode": "1000", "subtotal": "10"}, format="json").status_code == 400
        assert api_client.post("/api/v1/orders/promo/check/", {"restaurant": str(other_restaurant.id), "code": "X", "subtotal": "10"}, format="json").status_code == 400

    def test_owner_scope_unchanged(self, api_client, single_mode, restaurateur_user, dish):
        """Le propriétaire reste la source de vérité des permissions : il gère son menu normalement."""
        api_client.force_authenticate(restaurateur_user)
        assert api_client.patch(f"/api/v1/menus/items/{dish.id}/", {"price": "11.00"}, format="json").status_code == 200
        assert api_client.patch(f"/api/v1/restaurants/{single_mode.id}/", {"cuisine": ["Belge", "Burger"]}, format="json").data["cuisine"] == ["Belge", "Burger"]

    def test_timezone_setting_is_used(self, settings, restaurant):
        settings.TIME_ZONE = "Europe/Paris"
        from django.utils import timezone as tz
        assert str(tz.get_current_timezone()) == "Europe/Paris"
        from apps.tenant.context import tenant_timezone
        settings.TENANT_TIMEZONE = "Europe/Paris"
        assert tenant_timezone() == "Europe/Paris"


# ═══════════════════════════════════════════════════════════════════════════
# E-mails, notifications, tâches planifiées sous la marque (R9)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.django_db
class TestBrandedMessages:
    def _order(self, api_client, client_user, restaurant, dish):
        api_client.force_authenticate(client_user)
        return api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                                    "pickup_date": timezone.localdate().isoformat(), "items": [{"menu_item_id": str(dish.id), "qty": 1}]}, format="json")

    def test_confirmation_email_signed_by_brand(self, api_client, single_mode, client_user, dish, settings):
        settings.EMAIL_SYNC = True
        Branding.for_restaurant(single_mode)
        Branding.objects.filter(restaurant=single_mode).update(app_name="Burger House", sender_name="Burger House")
        assert self._order(api_client, client_user, single_mode, dish).status_code == 201
        m = mail.outbox[-1]
        assert m.subject.startswith("[Burger House]") and "— Burger House" in m.body
        assert m.from_email.startswith("Burger House via PickEatGo <") and "propulsée par PickEatGo" in m.body

    def test_badge_can_be_removed(self, api_client, single_mode, client_user, dish, settings):
        settings.EMAIL_SYNC = True; settings.POWERED_BY_BADGE = False
        assert self._order(api_client, client_user, single_mode, dish).status_code == 201
        m = mail.outbox[-1]
        assert "propulsée par PickEatGo" not in m.body and " via PickEatGo" not in m.from_email
        assert api_client.get("/api/v1/branding/").data["powered_by_badge"] is False

    def test_platform_emails_unchanged(self, api_client, restaurant, client_user, dish, settings):
        settings.APP_MODE = "platform"; settings.EMAIL_SYNC = True
        assert self._order(api_client, client_user, restaurant, dish).status_code == 201
        assert mail.outbox[-1].subject.startswith("[PickEatGo]") and "— PickEatGo" in mail.outbox[-1].body

    def test_push_carries_app_name(self, api_client, single_mode, client_user, dish, settings, monkeypatch):
        settings.VAPID_PUBLIC_KEY = "pub"; settings.VAPID_PRIVATE_KEY = "priv"
        sent = []
        monkeypatch.setattr(push_service, "_deliver", lambda ids, payload: sent.append(payload))
        Branding.for_restaurant(single_mode)
        Branding.objects.filter(restaurant=single_mode).update(app_name="Burger House")
        api_client.force_authenticate(client_user)
        api_client.post("/api/v1/notifications/push/subscription/", {"endpoint": "https://push.example.com/a", "keys": {"p256dh": "p", "auth": "a"}}, format="json")
        r = api_client.post("/api/v1/notifications/push/test/")
        assert r.status_code == 200 and sent[-1]["title"] == "Burger House 👋" and sent[-1]["app"] == "Burger House"

    def test_scheduled_commands_only_tenant(self, single_mode, other_restaurant, dish, settings, capsys):
        settings.EMAIL_SYNC = True
        MenuItem.objects.filter(pk=dish.pk).update(stock_qty=0)
        cat = other_restaurant.categories.first()
        MenuItem.objects.filter(category=cat).update(stock_qty=0)
        call_command("stock_digest")
        assert len(mail.outbox) == 1 and mail.outbox[0].to == [single_mode.owner.email] and mail.outbox[0].subject.startswith("[Test Burger]")
        mail.outbox.clear()
        call_command("weekly_report")
        assert len(mail.outbox) == 1 and mail.outbox[0].to == [single_mode.owner.email]


# ═══════════════════════════════════════════════════════════════════════════
# Amorçage, vérifications de démarrage, fiche d'instance
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.django_db
class TestBootstrapAndChecks:
    def test_bootstrap_tenant_creates_everything(self, settings, capsys):
        settings.APP_MODE = "single"; settings.TENANT_RESTAURANT_ID = None
        call_command("bootstrap_tenant", name="Burger House", email="Marie@BurgerHouse.be", password="Secret1234!",
                     address="12 Rue de la Paix", phone="+32 2 1", cuisine=["Américain"], skip_migrate=True)
        out = capsys.readouterr().out
        user = User.objects.get(email="marie@burgerhouse.be")
        resto = Restaurant.objects.get(owner=user)
        assert user.role == User.RESTAURATEUR and user.check_password("Secret1234!")
        assert resto.status == Restaurant.ACTIVE and resto.is_open is False and resto.cuisine == ["Américain"]
        assert list(resto.categories.order_by("order").values_list("name", flat=True)) == ["Entrées", "Plats", "Desserts", "Boissons"]
        assert BusinessHours.objects.filter(restaurant=resto).count() == 7
        assert Branding.objects.get(restaurant=resto).app_name == "Burger House"
        assert f"TENANT_RESTAURANT_ID={resto.id}" in out
        # Idempotent
        call_command("bootstrap_tenant", name="Burger House", email="marie@burgerhouse.be", skip_migrate=True)
        assert Restaurant.objects.count() == 1 and Branding.objects.count() == 1

    def test_bootstrap_with_forced_id(self, settings):
        """Outillage : l'identifiant est choisi avant le déploiement et imposé au restaurant."""
        import uuid as _uuid
        from django.core.management.base import CommandError
        rid = _uuid.uuid4()
        call_command("bootstrap_tenant", name="Pizza Roma", email="luigi@roma.be", password="Secret1234!", restaurant_id=str(rid), skip_migrate=True)
        assert Restaurant.objects.get(pk=rid).name == "Pizza Roma"
        with pytest.raises(CommandError):
            call_command("bootstrap_tenant", name="Pizza Roma", email="luigi@roma.be", restaurant_id=str(_uuid.uuid4()), skip_migrate=True)
        with pytest.raises(CommandError):
            call_command("bootstrap_tenant", name="X", email="x@x.be", restaurant_id="pas-un-uuid", skip_migrate=True)

    def test_startup_checks(self, settings, restaurant):
        from apps.tenant.checks import check_tenant_settings, verify_tenant_or_fail
        from django.core.exceptions import ImproperlyConfigured
        settings.APP_MODE = "single"; settings.TENANT_RESTAURANT_ID = None
        assert [e.id for e in check_tenant_settings(None)] == ["tenant.W001"]
        settings.TENANT_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001"
        assert [e.id for e in check_tenant_settings(None)] == ["tenant.E002"]
        with pytest.raises(ImproperlyConfigured):
            verify_tenant_or_fail()
        settings.TENANT_RESTAURANT_ID = str(restaurant.id)
        assert check_tenant_settings(None) == []
        verify_tenant_or_fail()
        settings.APP_MODE = "weird"
        assert [e.id for e in check_tenant_settings(None)] == ["tenant.E001"]
        settings.APP_MODE = "platform"; settings.TENANT_TIMEZONE = "Mars/Olympus"
        assert [e.id for e in check_tenant_settings(None)] == ["tenant.E003"]

    def test_instance_info_admin_only(self, api_client, single_mode, restaurateur_user, admin_user):
        api_client.force_authenticate(restaurateur_user)
        assert api_client.get("/api/v1/branding/instance/").status_code == 403
        api_client.force_authenticate(admin_user)
        r = api_client.get("/api/v1/branding/instance/")
        assert r.status_code == 200
        assert r.data["mode"] == "single" and r.data["licensee"]["restaurant_id"] == str(single_mode.id)
        assert set(r.data["services"]) >= {"database", "redis", "cloudinary", "smtp", "push"}
        assert "version" in r.data and "log" in r.data and r.data["activity"]["orders"] == 0
