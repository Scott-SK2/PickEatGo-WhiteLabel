"""
orders/reports.py — Rapports de ventes, statistiques et clôture de journée.

Une « vente » est une commande au statut Récupérée (payée et remise au client),
qu'elle vienne du site (à emporter / sur place) ou du comptoir.
Les dates sont exprimées dans le fuseau du restaurant (TIME_ZONE).
"""
import csv
import io
from collections import OrderedDict
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from apps.menus.models import StockMovement
from .models import Order

DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
PAYMENT_LABELS = {Order.PAY_CASH: "Espèces", Order.PAY_CARD: "Carte", Order.PAY_ONLINE: "En ligne", "": "Non renseigné"}
TYPE_LABELS = dict(Order.TYPE_CHOICES)


def parse_range(params, default_days=30):
    """Lit ?from=YYYY-MM-DD&to=YYYY-MM-DD (défaut : 30 derniers jours). Borné à 366 jours."""
    today = timezone.localdate()
    try:
        d_to = date.fromisoformat(params.get("to")) if params.get("to") else today
    except ValueError:
        d_to = today
    try:
        d_from = date.fromisoformat(params.get("from")) if params.get("from") else d_to - timedelta(days=default_days - 1)
    except ValueError:
        d_from = d_to - timedelta(days=default_days - 1)
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    if (d_to - d_from).days > 366:
        d_from = d_to - timedelta(days=366)
    return d_from, d_to


def sales_orders(restaurant, d_from, d_to):
    return (Order.objects
            .filter(restaurant=restaurant, status=Order.PICKED_UP,
                    created_at__date__gte=d_from, created_at__date__lte=d_to)
            .select_related("employee", "created_by")
            .prefetch_related("items__menu_item")
            .order_by("created_at"))


def _period_key(local_dt, group):
    if group == "month":
        return local_dt.strftime("%Y-%m"), local_dt.strftime("%b %Y")
    if group == "week":
        iso = local_dt.isocalendar()
        return f"{iso[0]}-S{iso[1]:02d}", f"S{iso[1]:02d} {iso[0]}"
    d = local_dt.date()
    return d.isoformat(), f"{DAY_LABELS[d.weekday()]} {d.day:02d}/{d.month:02d}"


def _money(value):
    return str(Decimal(value).quantize(Decimal("0.01")))


def _period_totals(restaurant, d_from, d_to):
    """Totaux bruts d'une période (pour la comparaison avec la période précédente)."""
    orders = sales_orders(restaurant, d_from, d_to)
    n = 0
    revenue = Decimal(0)
    items = 0
    for o in orders:
        n += 1
        revenue += o.total_price
        items += sum(l.qty for l in o.items.all())
    return {"orders": n, "revenue": revenue, "items_sold": items, "avg_basket": (revenue / n) if n else Decimal(0)}


def _pct(current, previous):
    if not previous:
        return None
    return round(float((Decimal(current) - Decimal(previous)) / Decimal(previous) * 100), 1)


def compare_with_previous(restaurant, d_from, d_to, current):
    """Période précédente de même durée : totaux + variation en %."""
    days = (d_to - d_from).days + 1
    p_to = d_from - timedelta(days=1)
    p_from = p_to - timedelta(days=days - 1)
    prev = _period_totals(restaurant, p_from, p_to)
    return {
        "from": p_from.isoformat(), "to": p_to.isoformat(),
        "orders": prev["orders"], "revenue": _money(prev["revenue"]), "items_sold": prev["items_sold"], "avg_basket": _money(prev["avg_basket"]),
        "delta": {
            "orders": _pct(current["orders"], prev["orders"]),
            "revenue": _pct(current["revenue"], prev["revenue"]),
            "items_sold": _pct(current["items_sold"], prev["items_sold"]),
            "avg_basket": _pct(current["avg_basket"], prev["avg_basket"]),
        },
    }


def sales_summary(restaurant, d_from, d_to, group="day"):
    """Synthèse complète des ventes sur une période."""
    orders = list(sales_orders(restaurant, d_from, d_to))

    periods = OrderedDict()
    if group == "day":
        # Toutes les journées de la plage, même sans vente (courbe continue)
        cursor = d_from
        while cursor <= d_to:
            key, label = _period_key(timezone.make_aware(timezone.datetime.combine(cursor, timezone.datetime.min.time())), "day")
            periods[key] = {"key": key, "label": label, "orders": 0, "revenue": Decimal(0), "online": 0, "counter": 0}
            cursor += timedelta(days=1)

    by_payment = {k: {"key": k, "label": v, "orders": 0, "revenue": Decimal(0)} for k, v in PAYMENT_LABELS.items()}
    by_product = {}
    by_employee = {}
    by_hour = [0] * 24
    items_sold = 0
    revenue = Decimal(0)
    discounts = Decimal(0)
    discounted_orders = 0
    online = counter = 0

    for o in orders:
        if o.discount_amount:
            discounts += o.discount_amount
            discounted_orders += 1
        local = timezone.localtime(o.created_at)
        key, label = _period_key(local, group)
        p = periods.setdefault(key, {"key": key, "label": label, "orders": 0, "revenue": Decimal(0), "online": 0, "counter": 0})
        p["orders"] += 1
        p["revenue"] += o.total_price
        is_counter = o.order_type == Order.COUNTER
        p["counter" if is_counter else "online"] += 1
        counter += is_counter
        online += not is_counter
        revenue += o.total_price
        by_hour[local.hour] += 1

        if o.employee_id or is_counter:
            ekey = str(o.employee_id) if o.employee_id else "owner"
            ename = o.employee.name if o.employee_id else (o.created_by.full_name if o.created_by else "Propriétaire")
            emp = by_employee.setdefault(ekey, {"key": ekey, "name": ename, "orders": 0, "revenue": Decimal(0)})
            emp["orders"] += 1
            emp["revenue"] += o.total_price

        pay = by_payment.setdefault(o.payment_method or "", {"key": o.payment_method, "label": PAYMENT_LABELS.get(o.payment_method, o.payment_method), "orders": 0, "revenue": Decimal(0)})
        pay["orders"] += 1
        pay["revenue"] += o.total_price

        for line in o.items.all():
            mi = line.menu_item
            pid = str(mi.id) if mi else f"deleted:{line.name}"
            prod = by_product.setdefault(pid, {"menu_item_id": str(mi.id) if mi else None, "name": line.name,
                                               "qty": 0, "revenue": Decimal(0), "cost": None})
            prod["qty"] += line.qty
            prod["revenue"] += line.subtotal
            items_sold += line.qty
            if mi is not None and mi.cost_price is not None:
                prod["cost"] = (prod["cost"] or Decimal(0)) + mi.cost_price * line.qty

    products = sorted(by_product.values(), key=lambda x: (-x["qty"], x["name"]))
    for prod in products:
        prod["revenue"] = _money(prod["revenue"])
        if prod["cost"] is not None:
            prod["margin"] = _money(Decimal(prod["revenue"]) - prod["cost"])
            prod["cost"] = _money(prod["cost"])
        else:
            prod["margin"] = None

    waste_qs = StockMovement.objects.filter(item__category__restaurant=restaurant, reason=StockMovement.WASTE,
                                            created_at__date__gte=d_from, created_at__date__lte=d_to)
    waste_count = sum(abs(m.delta) for m in waste_qs)
    waste_value = sum((abs(m.delta) * m.unit_cost for m in waste_qs if m.unit_cost is not None), Decimal(0))

    cancelled = Order.objects.filter(restaurant=restaurant, status=Order.CANCELLED,
                                     created_at__date__gte=d_from, created_at__date__lte=d_to).count()
    n = len(orders)
    best_period = max(periods.values(), key=lambda p: p["revenue"], default=None)
    best_hour = max(range(24), key=lambda h: by_hour[h]) if any(by_hour) else None
    current = {"orders": n, "revenue": revenue, "items_sold": items_sold, "avg_basket": (revenue / n) if n else Decimal(0)}
    return {
        "from": d_from.isoformat(), "to": d_to.isoformat(), "group": group,
        "totals": {
            "orders": n, "revenue": _money(revenue), "items_sold": items_sold,
            "avg_basket": _money(revenue / n) if n else "0.00",
            "online_orders": online, "counter_orders": counter, "cancelled_orders": cancelled,
            "waste_count": waste_count, "waste_value": _money(waste_value),
            "discounts": _money(discounts), "discounted_orders": discounted_orders,
            "best_period": {"label": best_period["label"], "revenue": _money(best_period["revenue"]), "orders": best_period["orders"]} if best_period and best_period["orders"] else None,
            "best_hour": best_hour,
        },
        "previous": compare_with_previous(restaurant, d_from, d_to, current),
        "periods": [{**p, "revenue": _money(p["revenue"])} for p in periods.values()],
        "by_payment": [{**p, "revenue": _money(p["revenue"])} for p in by_payment.values() if p["orders"]],
        "by_product": products,
        "by_employee": sorted([{**e, "revenue": _money(e["revenue"])} for e in by_employee.values()], key=lambda e: -Decimal(e["revenue"])),
        "by_hour": by_hour,
    }


def daily_stats(restaurant, days=7):
    """Activité des N derniers jours (commandes non annulées, revenu des ventes récupérées) pour les graphiques."""
    today = timezone.localdate()
    d_from = today - timedelta(days=days - 1)
    qs = Order.objects.filter(restaurant=restaurant, created_at__date__gte=d_from).exclude(status=Order.CANCELLED)
    buckets = OrderedDict()
    cursor = d_from
    while cursor <= today:
        buckets[cursor] = {"date": cursor.isoformat(), "label": "Auj" if cursor == today else DAY_LABELS[cursor.weekday()],
                           "orders": 0, "revenue": Decimal(0)}
        cursor += timedelta(days=1)
    for o in qs.only("created_at", "status", "total_price"):
        d = timezone.localtime(o.created_at).date()
        if d in buckets:
            buckets[d]["orders"] += 1
            if o.status == Order.PICKED_UP:
                buckets[d]["revenue"] += o.total_price
    return [{**b, "revenue": _money(b["revenue"])} for b in buckets.values()]


def closure_data(restaurant, d):
    """Données d'une clôture de journée (aperçu ou enregistrement)."""
    s = sales_summary(restaurant, d, d, "day")
    pay = {p["key"]: Decimal(p["revenue"]) for p in s["by_payment"]}
    return {
        "date": d.isoformat(),
        "orders_count":      s["totals"]["orders"],
        "items_count":       s["totals"]["items_sold"],
        "total":             s["totals"]["revenue"],
        "total_cash":        _money(pay.get(Order.PAY_CASH, 0)),
        "total_card":        _money(pay.get(Order.PAY_CARD, 0)),
        "total_online":      _money(pay.get(Order.PAY_ONLINE, 0)),
        "total_unspecified": _money(pay.get("", 0) + pay.get(None, 0)),
        "online_orders":     s["totals"]["online_orders"],
        "counter_orders":    s["totals"]["counter_orders"],
        "cancelled_orders":  s["totals"]["cancelled_orders"],
        "waste_count":       s["totals"]["waste_count"],
        "waste_value":       s["totals"]["waste_value"],
        "items_summary":     [{"name": p["name"], "qty": p["qty"], "revenue": p["revenue"]} for p in s["by_product"]],
    }


def customers_summary(restaurant, search="", ordering="-total_spent", show_contact_for_admin=False):
    """
    Clientèle d'un restaurant : un enregistrement par client ayant commandé (ventes comptoir exclues).
    Les coordonnées ne sont fournies que si le client les a rendues visibles (phone_visible).
    """
    from collections import Counter
    orders = (Order.objects
              .filter(restaurant=restaurant, client__isnull=False)
              .exclude(status=Order.CANCELLED)
              .select_related("client")
              .prefetch_related("items")
              .order_by("created_at"))
    by_client = {}
    for o in orders:
        c = o.client
        rec = by_client.get(c.id)
        if rec is None:
            rec = by_client[c.id] = {
                "id": str(c.id), "name": c.full_name, "initial": (c.first_name or c.email or "?")[0].upper(),
                "contact_visible": bool(c.phone_visible) or show_contact_for_admin,
                "phone": None, "email": None,
                "orders": 0, "completed": 0, "total_spent": Decimal(0),
                "first_order": o.created_at, "last_order": o.created_at,
                "_items": Counter(), "_ratings": [],
            }
            if rec["contact_visible"]:
                rec["phone"] = c.phone or None
                rec["email"] = c.email
        rec["orders"] += 1
        rec["last_order"] = o.created_at
        if o.status == Order.PICKED_UP:
            rec["completed"] += 1
            rec["total_spent"] += o.total_price
        for line in o.items.all():
            rec["_items"][line.name] += line.qty
        if o.client_rating:
            rec["_ratings"].append(o.client_rating)

    today = timezone.localdate()
    month_start = today.replace(day=1)
    customers = []
    for rec in by_client.values():
        fav = rec["_items"].most_common(1)
        ratings = rec["_ratings"]
        customers.append({
            **{k: v for k, v in rec.items() if not k.startswith("_")},
            "total_spent": _money(rec["total_spent"]),
            "avg_basket": _money(rec["total_spent"] / rec["completed"]) if rec["completed"] else "0.00",
            "favorite": fav[0][0] if fav else None,
            "avg_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
            "first_order": rec["first_order"].isoformat(),
            "last_order": rec["last_order"].isoformat(),
            "is_new": timezone.localtime(rec["first_order"]).date() >= month_start,
            "is_regular": rec["completed"] >= 3,
        })

    q = (search or "").strip().lower()
    if q:
        customers = [c for c in customers if q in c["name"].lower() or (c["email"] and q in c["email"].lower())]

    key = ordering.lstrip("-")
    reverse = ordering.startswith("-")
    sorters = {
        "total_spent": lambda c: Decimal(c["total_spent"]),
        "orders":      lambda c: c["orders"],
        "last_order":  lambda c: c["last_order"],
        "name":        lambda c: c["name"].lower(),
    }
    customers.sort(key=sorters.get(key, sorters["total_spent"]), reverse=reverse)

    all_customers = list(by_client.values())
    return {
        "stats": {
            "customers":  len(all_customers),
            "new_month":  sum(1 for r in all_customers if timezone.localtime(r["first_order"]).date() >= month_start),
            "regulars":   sum(1 for r in all_customers if r["completed"] >= 3),
            "avg_spent":  _money(sum((r["total_spent"] for r in all_customers), Decimal(0)) / len(all_customers)) if all_customers else "0.00",
        },
        "customers": customers,
    }


CUSTOMER_EXPORT_HEADERS = ["Client", "Téléphone", "E-mail", "Commandes", "Total dépensé", "Panier moyen",
                           "Première commande", "Dernière commande", "Plat préféré", "Note moyenne"]


def customers_export_csv(customers):
    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(CUSTOMER_EXPORT_HEADERS)
    for c in customers:
        writer.writerow([_safe(c["name"]), _safe(c["phone"]), _safe(c["email"]), c["orders"],
                         c["total_spent"].replace(".", ","), c["avg_basket"].replace(".", ","),
                         c["first_order"][:10], c["last_order"][:10], c["favorite"] or "", c["avg_rating"] or ""])
    return buf.getvalue()


EXPORT_HEADERS = ["Date", "Heure", "N° commande", "Type", "Paiement", "Article", "Quantité",
                  "Prix unitaire", "Sous-total", "Total commande", "Client"]


def _safe(value):
    """Neutralise les formules dans les exports tableur (=, +, -, @ en début de cellule)."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def export_rows(restaurant, d_from, d_to):
    """Une ligne par article vendu — format tableur pour la comptabilité."""
    rows = []
    for o in sales_orders(restaurant, d_from, d_to):
        local = timezone.localtime(o.created_at)
        client = "Vente comptoir" if o.order_type == Order.COUNTER else (o.client.full_name if o.client else "")
        for line in o.items.all():
            rows.append([
                local.strftime("%d/%m/%Y"), local.strftime("%H:%M"), o.number,
                TYPE_LABELS.get(o.order_type, o.order_type), PAYMENT_LABELS.get(o.payment_method, ""),
                _safe(line.name), line.qty, float(line.price), float(line.subtotal), float(o.total_price), _safe(client),
            ])
    return rows


def export_csv(rows):
    buf = io.StringIO()
    buf.write("﻿")  # BOM : Excel ouvre le CSV avec les accents corrects
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(EXPORT_HEADERS)
    for r in rows:
        writer.writerow([str(v).replace(".", ",") if isinstance(v, float) else v for v in r])
    return buf.getvalue()


def export_xlsx(rows, title="Ventes"):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = title[:31]
    ws.append(EXPORT_HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="FF6B2C")
    for r in rows:
        ws.append(r)
    for col, width in zip("ABCDEFGHIJK", [12, 8, 12, 12, 14, 32, 10, 14, 12, 16, 24]):
        ws.column_dimensions[col].width = width
    for row in ws.iter_rows(min_row=2, min_col=8, max_col=10):
        for cell in row:
            cell.number_format = "#,##0.00 €"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
