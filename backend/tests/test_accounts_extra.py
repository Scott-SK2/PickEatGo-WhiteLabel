"""Tests mot de passe (changement, réinitialisation) et e-mails transactionnels."""
import re
import pytest
from decimal import Decimal
from django.core import mail
from django.utils import timezone
from apps.menus.models import Category, MenuItem


@pytest.mark.django_db
class TestPassword:
    def test_change_password(self, api_client, client_user):
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/auth/change-password/", {"old_password": "wrong", "new_password": "newpass123"}, format="json")
        assert r.status_code == 400
        r = api_client.post("/api/v1/auth/change-password/", {"old_password": "pass1234", "new_password": "newpass123"}, format="json")
        assert r.status_code == 200
        client_user.refresh_from_db()
        assert client_user.check_password("newpass123")

    def test_reset_flow(self, api_client, client_user, settings):
        settings.FRONTEND_URL = "https://app.test"
        r = api_client.post("/api/v1/auth/password-reset/", {"email": "nobody@test.com"}, format="json")
        assert r.status_code == 200 and len(mail.outbox) == 0          # même réponse, pas d'e-mail
        r = api_client.post("/api/v1/auth/password-reset/", {"email": client_user.email.upper()}, format="json")
        assert r.status_code == 200 and len(mail.outbox) == 1
        link = re.search(r"https://app\.test/reset\?uid=([^&]+)&token=(\S+)", mail.outbox[0].body)
        assert link, mail.outbox[0].body
        uid, token = link.group(1), link.group(2)
        assert api_client.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": "bad", "new_password": "resetpass1"}, format="json").status_code == 400
        r = api_client.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "resetpass1"}, format="json")
        assert r.status_code == 200
        client_user.refresh_from_db()
        assert client_user.check_password("resetpass1")
        # Le lien ne sert qu'une fois
        assert api_client.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "again1234"}, format="json").status_code == 400


@pytest.mark.django_db
class TestTransactionalEmails:
    def test_confirmation_and_ready_emails(self, api_client, client_user, restaurant, settings):
        settings.EMAIL_SYNC = True
        cat = Category.objects.create(restaurant=restaurant, name="Plats")
        dish = MenuItem.objects.create(category=cat, name="Burger", price=Decimal("9.50"))
        api_client.force_authenticate(client_user)
        r = api_client.post("/api/v1/orders/", {"restaurant": str(restaurant.id), "order_type": "emporter", "pickup_slot": "23:59",
                                                 "pickup_date": timezone.localdate().isoformat(),
                                                 "items": [{"menu_item_id": str(dish.id), "qty": 2}]}, format="json")
        assert r.status_code == 201
        assert len(mail.outbox) == 1 and "enregistrée" in mail.outbox[0].subject and "2× Burger" in mail.outbox[0].body
        assert mail.outbox[0].to == [client_user.email]
        api_client.force_authenticate(restaurant.owner)
        for _ in range(3):
            api_client.patch(f"/api/v1/orders/{r.data['id']}/advance/", {}, format="json")
        assert len(mail.outbox) == 2 and "prête" in mail.outbox[1].subject


@pytest.mark.django_db
class TestCreateAdmin:
    def test_creates_then_idempotent(self, monkeypatch, django_user_model):
        from django.core.management import call_command
        monkeypatch.setenv("ADMIN_EMAIL", "Boss@Test.com"); monkeypatch.setenv("ADMIN_PASSWORD", "supersecret1")
        call_command("create_admin"); call_command("create_admin")
        u = django_user_model.objects.get(email="boss@test.com")
        assert u.role == "admin" and u.is_superuser and u.check_password("supersecret1")
        assert django_user_model.objects.filter(role="admin").count() == 1

    def test_reset_password_flag(self, monkeypatch, django_user_model):
        from django.core.management import call_command
        django_user_model.objects.create_superuser(email="boss@test.com", password="oldpass123", first_name="B", last_name="T")
        monkeypatch.setenv("ADMIN_EMAIL", "boss@test.com"); monkeypatch.setenv("ADMIN_PASSWORD", "newpass456")
        call_command("create_admin")
        assert django_user_model.objects.get(email="boss@test.com").check_password("oldpass123")   # sans le drapeau : inchangé
        monkeypatch.setenv("ADMIN_RESET_PASSWORD", "1")
        call_command("create_admin")
        assert django_user_model.objects.get(email="boss@test.com").check_password("newpass456")
