"""Rapport comptable : TVA par taux, journal par jour, PDF, envoi au comptable, commande mensuelle."""
from decimal import Decimal

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone

from apps.menus.models import Category, MenuItem
from apps.orders import accounting
from apps.orders.models import Order, OrderItem


@pytest.fixture
def menu(restaurant):
    cat = Category.objects.create(restaurant=restaurant, name="Plats", order=0)
    return {"burger": MenuItem.objects.create(category=cat, name="Burger", price=Decimal("10.60")),
            "biere": MenuItem.objects.create(category=cat, name="Bière", price=Decimal("4.84"), vat_rate=Decimal("21"))}


@pytest.fixture
def owner_client(api_client, restaurateur_user):
    api_client.force_authenticate(restaurateur_user)
    return api_client


def _sale(restaurant, items, order_type=Order.PICKUP, payment=Order.PAY_CARD, discount="0", delivery="0", status=Order.PICKED_UP):
    """Vente déjà remise, avec le taux de TVA figé comme le fait la création de commande."""
    now = timezone.localtime()
    order = Order.objects.create(restaurant=restaurant, order_type=order_type, status=status, payment_method=payment,
                                 pickup_date=now.date(), pickup_slot=now.time().replace(microsecond=0),
                                 total_price=0, discount_amount=Decimal(discount), delivery_fee=Decimal(delivery))
    gross = Decimal(0)
    for item, qty in items:
        OrderItem.objects.create(order=order, menu_item=item, name=item.name, price=item.price, qty=qty,
                                 vat_rate=accounting.vat_rate_for(restaurant, order_type, item))
        gross += item.price * qty
    order.total_price = gross - Decimal(discount) + Decimal(delivery)
    order.save(update_fields=["total_price"])
    return order


@pytest.mark.django_db
class TestVatRates:
    def test_rate_by_service_mode_and_item_override(self, restaurant, menu):
        assert accounting.vat_rate_for(restaurant, Order.ON_SITE, menu["burger"]) == Decimal("12.00")
        assert accounting.vat_rate_for(restaurant, Order.PICKUP, menu["burger"]) == Decimal("6.00")
        assert accounting.vat_rate_for(restaurant, Order.DELIVERY, menu["burger"]) == Decimal("6.00")
        assert accounting.vat_rate_for(restaurant, Order.COUNTER, menu["burger"]) == Decimal("6.00")
        restaurant.counter_is_on_site = True
        assert accounting.vat_rate_for(restaurant, Order.COUNTER, menu["burger"]) == Decimal("12.00")
        assert accounting.vat_rate_for(restaurant, Order.PICKUP, menu["biere"]) == Decimal("21")      # taux propre au plat

    def test_rate_is_frozen_on_the_order_line(self, owner_client, api_client, restaurant, menu):
        r = owner_client.post("/api/v1/orders/counter/", {"restaurant": str(restaurant.id), "payment_method": "carte",
                                                           "items": [{"menu_item_id": str(menu["burger"].id), "qty": 1}, {"menu_item_id": str(menu["biere"].id), "qty": 1}]}, format="json")
        assert r.status_code == 201, r.data
        rates = dict(OrderItem.objects.filter(order_id=r.data["id"]).values_list("name", "vat_rate"))
        assert rates == {"Burger": Decimal("6.00"), "Bière": Decimal("21.00")}
        # Un changement de réglage ne modifie pas les ventes déjà enregistrées
        restaurant.vat_rate_takeaway = Decimal("9"); restaurant.save()
        today = timezone.localdate()
        report = accounting.accounting_report(restaurant, today, today)
        assert [v["rate"] for v in report["vat"]] == ["6.00", "21.00"]

    def test_settings_are_saved_and_private(self, owner_client, api_client, restaurant, menu):
        r = owner_client.patch(f"/api/v1/restaurants/{restaurant.id}/", {"vat_rate_on_site": "10", "accountant_email": "compta@cabinet.be", "accounting_auto_send": True}, format="json")
        assert r.status_code == 200, r.data
        assert r.data["vat_rate_on_site"] == "10.00" and r.data["accountant_email"] == "compta@cabinet.be"
        assert owner_client.patch(f"/api/v1/restaurants/{restaurant.id}/", {"vat_rate_takeaway": "150"}, format="json").status_code == 400
        assert owner_client.patch(f"/api/v1/menus/items/{menu['burger'].id}/", {"vat_rate": "-1"}, format="json").status_code == 400
        api_client.force_authenticate(None)
        public = api_client.get(f"/api/v1/restaurants/{restaurant.id}/").data
        assert "accountant_email" not in public and "accounting_auto_send" not in public


@pytest.mark.django_db
class TestAccountingReport:
    def _seed(self, restaurant, menu):
        _sale(restaurant, [(menu["burger"], 1)], order_type=Order.PICKUP, payment=Order.PAY_CARD)                       # 10,60 à 6 %
        _sale(restaurant, [(menu["burger"], 1)], order_type=Order.ON_SITE, payment=Order.PAY_CASH)                      # 10,60 à 12 %
        _sale(restaurant, [(menu["burger"], 1), (menu["biere"], 1)], order_type=Order.ON_SITE, payment=Order.PAY_CASH)  # 10,60 à 12 % + 4,84 à 21 %
        _sale(restaurant, [(menu["burger"], 2)], order_type=Order.DELIVERY, payment=Order.PAY_CARD, discount="2.12", delivery="2.50")   # 19,08 + 2,50 à 6 %
        _sale(restaurant, [(menu["burger"], 5)], status=Order.CANCELLED)                                                # non comptée

    def test_vat_breakdown_and_totals(self, restaurant, menu):
        self._seed(restaurant, menu)
        today = timezone.localdate()
        rep = accounting.accounting_report(restaurant, today, today)
        vat = {v["rate"]: v for v in rep["vat"]}
        assert vat["6.00"] == {"rate": "6.00", "base": "30.36", "vat": "1.82", "total": "32.18"}      # 10,60 + 19,08 + 2,50
        assert vat["12.00"] == {"rate": "12.00", "base": "18.93", "vat": "2.27", "total": "21.20"}
        assert vat["21.00"] == {"rate": "21.00", "base": "4.00", "vat": "0.84", "total": "4.84"}
        t = rep["totals"]
        assert t["orders"] == 4 and t["cancelled_orders"] == 1
        assert t["total"] == "58.22" and t["base"] == "53.29" and t["vat"] == "4.93"
        assert Decimal(t["base"]) + Decimal(t["vat"]) == Decimal(t["total"])
        assert sum(Decimal(v["total"]) for v in rep["vat"]) == Decimal(t["total"])                     # la remise et la livraison sont bien ventilées
        assert t["cash"] == "26.04" and t["card"] == "32.18" and t["discounts"] == "2.12" and t["delivery_fees"] == "2.50"
        assert {x["key"]: x["orders"] for x in rep["by_type"]} == {"emporter": 1, "sur_place": 2, "livraison": 1}
        day = rep["days"][0]
        assert day["orders"] == 4 and day["total"] == "58.22" and day["closed"] is False
        assert t["days_without_closure"] == 1

    def test_closure_and_gap(self, owner_client, restaurant, menu):
        self._seed(restaurant, menu)
        today = timezone.localdate()
        assert owner_client.post("/api/v1/orders/closures/", {"restaurant": str(restaurant.id)}, format="json").status_code == 201
        _sale(restaurant, [(menu["burger"], 1)])                                                       # vente après la clôture
        rep = accounting.accounting_report(restaurant, today, today)
        assert rep["days"][0]["closed"] is True and rep["totals"]["days_without_closure"] == 0
        assert rep["closures"][0]["total"] == "58.22" and rep["closures"][0]["gap"] == "10.60"

    def test_endpoint_json_pdf_and_permissions(self, owner_client, api_client, restaurant, menu, client_user):
        self._seed(restaurant, menu)
        month = timezone.localdate().strftime("%Y-%m")
        r = owner_client.get(f"/api/v1/orders/accounting/?restaurant={restaurant.id}&month={month}")
        assert r.status_code == 200 and r.data["totals"]["total"] == "58.22"
        assert r.data["from"].endswith("-01") and r.data["label"].endswith(str(timezone.localdate().year))
        r = owner_client.get(f"/api/v1/orders/accounting/?restaurant={restaurant.id}&month={month}&type=pdf")
        assert r.status_code == 200 and r["Content-Type"] == "application/pdf"
        assert r.content[:5] == b"%PDF-" and len(r.content) > 2000
        assert r["Content-Disposition"].startswith('attachment; filename="comptabilite-')
        api_client.force_authenticate(client_user)
        assert api_client.get(f"/api/v1/orders/accounting/?restaurant={restaurant.id}&type=pdf").status_code == 403
        api_client.force_authenticate(None)
        assert api_client.get(f"/api/v1/orders/accounting/?restaurant={restaurant.id}").status_code == 401

    def test_pdf_content(self, restaurant, menu):
        self._seed(restaurant, menu)
        today = timezone.localdate()
        report, pdf, xlsx, base = accounting.build_documents(restaurant, today, today)
        import io
        from pypdf import PdfReader
        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
        for expected in ("Rapport comptable", "Test Burger", "TVA par taux", "58,22 €", "4,93 €", "12 %", "21 %", "Journal des ventes par jour", "Clôtures de caisse"):
            assert expected in text, expected
        assert xlsx[:2] == b"PK" and base.startswith("comptabilite-")


@pytest.mark.django_db
class TestSendToAccountant:
    def test_send_now(self, owner_client, restaurant, menu, settings):
        settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
        _sale(restaurant, [(menu["burger"], 1)])
        r = owner_client.post("/api/v1/orders/accounting/send/", {"restaurant": str(restaurant.id)}, format="json")
        assert r.status_code == 400 and len(mail.outbox) == 0                                          # pas d'adresse de comptable
        assert owner_client.post("/api/v1/orders/accounting/send/", {"restaurant": str(restaurant.id), "email": "pas-une-adresse"}, format="json").status_code == 400
        restaurant.accountant_email = "compta@cabinet.be"; restaurant.save()
        r = owner_client.post("/api/v1/orders/accounting/send/", {"restaurant": str(restaurant.id)}, format="json")
        assert r.status_code == 200, r.data
        m = mail.outbox[0]
        assert m.to == ["compta@cabinet.be"] and m.cc == ["resto@test.com"] and "Rapport comptable" in m.subject
        assert [a[0].rsplit(".", 1)[1] for a in m.attachments] == ["pdf", "xlsx"] and m.attachments[0][1][:5] == b"%PDF-"
        assert "10,60 €" in m.body

    def test_send_refused_without_smtp(self, owner_client, restaurant, settings):
        settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
        restaurant.accountant_email = "compta@cabinet.be"; restaurant.save()
        r = owner_client.post("/api/v1/orders/accounting/send/", {"restaurant": str(restaurant.id)}, format="json")
        assert r.status_code == 400 and "pas encore configuré" in r.data["detail"]

    def test_monthly_command(self, restaurant, menu, settings, capsys):
        settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
        _sale(restaurant, [(menu["burger"], 1)])
        month = timezone.localdate().strftime("%Y-%m")
        call_command("monthly_accounting", month=month)
        assert len(mail.outbox) == 0                                                                   # envoi automatique non activé
        restaurant.accountant_email = "compta@cabinet.be"; restaurant.accounting_auto_send = True; restaurant.save()
        call_command("monthly_accounting", month=month, dry_run=True)
        assert len(mail.outbox) == 0 and "compta@cabinet.be" in capsys.readouterr().out
        call_command("monthly_accounting", month=month)
        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["compta@cabinet.be"]

    def test_default_month_is_previous_month(self):
        first, last = accounting.month_range()
        today = timezone.localdate()
        assert first.day == 1 and last < today.replace(day=1) and (last + timezone.timedelta(days=1)).day == 1
        assert accounting.month_range("2026-02") == (timezone.datetime(2026, 2, 1).date(), timezone.datetime(2026, 2, 28).date())
