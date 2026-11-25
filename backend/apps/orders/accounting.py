"""
orders/accounting.py — Rapport comptable d'une période : journal des ventes par jour, ventilation de la TVA
par taux, modes de paiement, modes de service, clôtures de caisse. Sert l'export PDF du tableau de bord et
l'envoi mensuel au comptable.

Règles :
  - une vente est une commande remise au client (statut Récupérée), comme dans reports.py ;
  - les prix sont TTC. Le taux de TVA d'une ligne est figé à la commande (OrderItem.vat_rate) ; pour les
    commandes antérieures, il est recalculé avec les réglages actuels du restaurant ;
  - taux d'une ligne : celui du plat s'il en a un, sinon le taux « sur place » ou « à emporter » du restaurant
    selon le mode de service (une vente au comptoir suit le réglage counter_is_on_site) ;
  - une remise est répartie sur les lignes au prorata ; les frais de livraison suivent le taux « à emporter » ;
  - la TVA est calculée sur le total TTC de la période pour chaque taux : HT = TTC / (1 + taux), TVA = TTC − HT.
"""
import io
from collections import OrderedDict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

CENT = Decimal("0.01")
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def _q(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def vat_rate_for(restaurant, order_type, menu_item=None):
    """Taux de TVA (%) applicable à un plat pour un mode de service donné."""
    from .models import Order
    if menu_item is not None and getattr(menu_item, "vat_rate", None) is not None:
        return menu_item.vat_rate
    on_site = order_type == Order.ON_SITE or (order_type == Order.COUNTER and restaurant.counter_is_on_site)
    return restaurant.vat_rate_on_site if on_site else restaurant.vat_rate_takeaway


def month_range(value=None):
    """« YYYY-MM » → (premier jour, dernier jour). Sans valeur : le mois précédent."""
    if value:
        year, month = (int(x) for x in str(value).split("-")[:2])
        first = date(year, month, 1)
    else:
        first = (timezone.localdate().replace(day=1) - timedelta(days=1)).replace(day=1)
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return first, last


def period_label(d_from, d_to):
    first, last = month_range(f"{d_from.year}-{d_from.month:02d}")
    if (d_from, d_to) == (first, last):
        return f"{MONTHS[d_from.month - 1]} {d_from.year}"
    return f"du {d_from.strftime('%d/%m/%Y')} au {d_to.strftime('%d/%m/%Y')}"


def _order_vat_lines(order, restaurant):
    """[(taux, montant TTC)] d'une commande : lignes nettes de remise + frais de livraison. La somme vaut total_price."""
    lines = [(line.vat_rate if line.vat_rate is not None else vat_rate_for(restaurant, order.order_type, line.menu_item), line.subtotal)
             for line in order.items.all()]
    gross = sum((amount for _, amount in lines), Decimal(0))
    net_target = order.total_price - order.delivery_fee          # ce que les lignes doivent totaliser après remise
    out = []
    if gross > 0 and lines:
        remaining = net_target
        for i, (rate, amount) in enumerate(lines):
            share = remaining if i == len(lines) - 1 else _q(amount * net_target / gross)   # la dernière ligne absorbe l'arrondi
            remaining -= share
            out.append((rate, share))
    elif net_target:
        out.append((restaurant.vat_rate_takeaway, net_target))
    if order.delivery_fee:
        out.append((restaurant.vat_rate_takeaway, order.delivery_fee))
    return out


def accounting_report(restaurant, d_from, d_to):
    """Toutes les données du rapport comptable (montants en chaînes « 12.34 »)."""
    from . import reports
    from .models import DailyClosure, Order

    orders = list(reports.sales_orders(restaurant, d_from, d_to))
    days = OrderedDict()
    cursor = d_from
    while cursor <= d_to:
        days[cursor] = {"date": cursor, "orders": 0, "cash": Decimal(0), "card": Decimal(0), "online": Decimal(0),
                        "unspecified": Decimal(0), "discounts": Decimal(0), "total": Decimal(0)}
        cursor += timedelta(days=1)
    pay_field = {Order.PAY_CASH: "cash", Order.PAY_CARD: "card", Order.PAY_ONLINE: "online"}
    by_rate, by_type = {}, OrderedDict((k, {"key": k, "label": v, "orders": 0, "total": Decimal(0)}) for k, v in Order.TYPE_CHOICES)
    totals = {"orders": 0, "total": Decimal(0), "discounts": Decimal(0), "delivery_fees": Decimal(0),
              "cash": Decimal(0), "card": Decimal(0), "online": Decimal(0), "unspecified": Decimal(0)}

    for o in orders:
        day = days.get(timezone.localtime(o.created_at).date())
        if day is None:
            continue
        field = pay_field.get(o.payment_method, "unspecified")
        for bucket in (day, totals):
            bucket["orders"] += 1
            bucket["total"] += o.total_price
            bucket["discounts"] += o.discount_amount
            bucket[field] += o.total_price
        totals["delivery_fees"] += o.delivery_fee
        t = by_type.setdefault(o.order_type, {"key": o.order_type, "label": o.order_type, "orders": 0, "total": Decimal(0)})
        t["orders"] += 1
        t["total"] += o.total_price
        for rate, amount in _order_vat_lines(o, restaurant):
            by_rate[_q(rate)] = by_rate.get(_q(rate), Decimal(0)) + amount

    vat_rows, total_ht, total_vat = [], Decimal(0), Decimal(0)
    for rate in sorted(by_rate):
        ttc = by_rate[rate]
        ht = _q(ttc / (1 + rate / 100))
        vat_rows.append({"rate": str(rate), "base": str(ht), "vat": str(_q(ttc - ht)), "total": str(_q(ttc))})
        total_ht += ht
        total_vat += ttc - ht

    closures = {c.date: c for c in DailyClosure.objects.filter(restaurant=restaurant, date__gte=d_from, date__lte=d_to).select_related("closed_by")}
    closure_rows = []
    for d, c in sorted(closures.items()):
        computed = days[d]["total"] if d in days else Decimal(0)
        closure_rows.append({"date": d.isoformat(), "closed_by": c.closed_by.full_name if c.closed_by else "", "orders": c.orders_count,
                             "cash": str(c.total_cash), "card": str(c.total_card), "online": str(c.total_online), "total": str(c.total),
                             "sales_total": str(_q(computed)), "gap": str(_q(computed - c.total)), "note": c.note})

    cancelled = Order.objects.filter(restaurant=restaurant, status=Order.CANCELLED, created_at__date__gte=d_from, created_at__date__lte=d_to).count()
    money = lambda v: str(_q(v))   # noqa: E731
    return {
        "from": d_from.isoformat(), "to": d_to.isoformat(), "label": period_label(d_from, d_to),
        "generated_at": timezone.localtime().isoformat(timespec="minutes"),
        "restaurant": {"id": str(restaurant.id), "name": restaurant.name, "address": restaurant.address, "city": restaurant.city,
                       "vat_number": restaurant.vat_number, "vat_rate_on_site": str(restaurant.vat_rate_on_site),
                       "vat_rate_takeaway": str(restaurant.vat_rate_takeaway), "counter_is_on_site": restaurant.counter_is_on_site},
        "totals": {"orders": totals["orders"], "total": money(totals["total"]), "base": money(total_ht), "vat": money(total_vat),
                   "discounts": money(totals["discounts"]), "delivery_fees": money(totals["delivery_fees"]), "cancelled_orders": cancelled,
                   "cash": money(totals["cash"]), "card": money(totals["card"]), "online": money(totals["online"]), "unspecified": money(totals["unspecified"]),
                   "days_with_sales": sum(1 for d in days.values() if d["orders"]), "closures": len(closure_rows),
                   "days_without_closure": sum(1 for d, v in days.items() if v["orders"] and d not in closures)},
        "vat": vat_rows,
        "by_type": [{**t, "total": money(t["total"])} for t in by_type.values() if t["orders"]],
        "days": [{"date": d.isoformat(), "orders": v["orders"], "cash": money(v["cash"]), "card": money(v["card"]), "online": money(v["online"]),
                  "unspecified": money(v["unspecified"]), "discounts": money(v["discounts"]), "total": money(v["total"]), "closed": d in closures}
                 for d, v in days.items()],
        "closures": closure_rows,
    }


# ── PDF ──────────────────────────────────────────────────────────────────────
def _txt(value):
    """Texte imprimable avec les polices standard du PDF (Latin-1 étendu) : les autres caractères sont retirés."""
    return str(value if value is not None else "").encode("cp1252", "ignore").decode("cp1252")


def _eur(value):
    q = _q(Decimal(str(value)))
    whole, cents = f"{abs(q):,.2f}".split(".")
    return f"{'-' if q < 0 else ''}{whole.replace(',', ' ')},{cents} €"


def _fr_date(iso):
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


def render_pdf(report, brand=None):
    """Rapport comptable au format PDF (A4 portrait) → bytes."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    brand = brand or {}
    app_name = _txt(brand.get("app_name") or report["restaurant"]["name"])
    legal = brand.get("legal") or {}
    ink, soft, rule, tint = colors.HexColor("#1E293B"), colors.HexColor("#64748B"), colors.HexColor("#CBD5E1"), colors.HexColor("#F1F5F9")
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=ink)
    h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=ink, spaceBefore=12, spaceAfter=5)
    body = ParagraphStyle("body", fontName="Helvetica", fontSize=9, leading=12.5, textColor=ink)
    small = ParagraphStyle("small", fontName="Helvetica", fontSize=7.8, leading=10.5, textColor=soft)

    def table(rows, widths, total_row=False, align_from=1):
        t = Table(rows, colWidths=widths, repeatRows=1)
        style = [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8), ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
                 ("TEXTCOLOR", (0, 0), (-1, 0), soft), ("TEXTCOLOR", (0, 1), (-1, -1), ink),
                 ("LINEBELOW", (0, 0), (-1, 0), 0.8, ink), ("LINEBELOW", (0, 1), (-1, -1), 0.25, rule),
                 ("ALIGN", (align_from, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                 ("TOPPADDING", (0, 0), (-1, -1), 3.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2)]
        if total_row:
            style += [("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 8.5), ("BACKGROUND", (0, -1), (-1, -1), tint),
                      ("LINEABOVE", (0, -1), (-1, -1), 0.8, ink)]
        t.setStyle(TableStyle(style))
        return t

    r, tot = report["restaurant"], report["totals"]
    story = [Paragraph(f"Rapport comptable — {_txt(report['label'])}", h1), Spacer(1, 3)]
    ident = [_txt(legal.get("legal_name") or r["name"])]
    if legal.get("legal_name") and legal["legal_name"] != r["name"]:
        ident.append(f"Enseigne : {_txt(r['name'])}")
    address = _txt(legal.get("legal_address") or ", ".join(x for x in (r["address"], r["city"]) if x and x not in (r["address"] or "")) or r["address"])
    if address:
        ident.append(address)
    numbers = " · ".join(x for x in (f"N° d'entreprise {_txt(legal['company_number'])}" if legal.get("company_number") else "",
                                     f"TVA {_txt(legal.get('vat_number') or r['vat_number'])}" if (legal.get("vat_number") or r["vat_number"]) else "") if x)
    if numbers:
        ident.append(numbers)
    story.append(Paragraph("<br/>".join(ident), body))
    story.append(Paragraph(f"Période du {_fr_date(report['from'])} au {_fr_date(report['to'])} · document établi le "
                           f"{_fr_date(report['generated_at'][:10])} à {report['generated_at'][11:16]}", small))

    story.append(Paragraph("Synthèse", h2))
    story.append(table([["", "Montant"],
                        ["Chiffre d'affaires TTC", _eur(tot["total"])],
                        ["Chiffre d'affaires HT", _eur(tot["base"])],
                        ["TVA collectée", _eur(tot["vat"])],
                        [f"Nombre de ventes ({tot['days_with_sales']} jour(s) d'activité)", str(tot["orders"])],
                        ["Remises accordées (déjà déduites du chiffre d'affaires)", _eur(tot["discounts"])],
                        ["Frais de livraison facturés (inclus dans le chiffre d'affaires)", _eur(tot["delivery_fees"])],
                        ["Commandes annulées (non comptées)", str(tot["cancelled_orders"])]], [125 * mm, 45 * mm]))

    story.append(Paragraph("TVA par taux", h2))
    vat_rows = [["Taux", "Base HT", "TVA", "Total TTC"]] + [[f"{Decimal(v['rate']).normalize():f} %".replace(".", ","), _eur(v["base"]), _eur(v["vat"]), _eur(v["total"])] for v in report["vat"]]
    vat_rows.append(["Total", _eur(tot["base"]), _eur(tot["vat"]), _eur(tot["total"])])
    story.append(table(vat_rows, [50 * mm, 40 * mm, 40 * mm, 40 * mm], total_row=True))

    story.append(Paragraph("Encaissements par mode de paiement", h2))
    pay_rows = [["Mode de paiement", "Montant TTC"], ["Espèces", _eur(tot["cash"])], ["Carte", _eur(tot["card"])], ["En ligne", _eur(tot["online"])]]
    if Decimal(tot["unspecified"]):
        pay_rows.append(["Non renseigné", _eur(tot["unspecified"])])
    pay_rows.append(["Total", _eur(tot["total"])])
    story.append(table(pay_rows, [125 * mm, 45 * mm], total_row=True))

    if report["by_type"]:
        story.append(Paragraph("Ventes par mode de service", h2))
        story.append(table([["Mode de service", "Ventes", "Montant TTC"]] + [[_txt(t["label"]), str(t["orders"]), _eur(t["total"])] for t in report["by_type"]]
                           + [["Total", str(tot["orders"]), _eur(tot["total"])]], [95 * mm, 30 * mm, 45 * mm], total_row=True))

    story.append(Paragraph("Journal des ventes par jour", h2))
    day_rows = [["Date", "Ventes", "Espèces", "Carte", "En ligne", "Remises", "Total TTC", "Clôture"]]
    for d in report["days"]:
        if not d["orders"] and not d["closed"]:
            continue
        other = Decimal(d["unspecified"])
        day_rows.append([_fr_date(d["date"]), str(d["orders"]), _eur(d["cash"]), _eur(d["card"]),
                         _eur(Decimal(d["online"]) + other) + (" *" if other else ""), _eur(d["discounts"]), _eur(d["total"]), "oui" if d["closed"] else "—"])
    day_rows.append(["Total", str(tot["orders"]), _eur(tot["cash"]), _eur(tot["card"]), _eur(Decimal(tot["online"]) + Decimal(tot["unspecified"])),
                     _eur(tot["discounts"]), _eur(tot["total"]), f"{tot['closures']}"])
    story.append(table(day_rows, [22 * mm, 14 * mm, 24 * mm, 24 * mm, 24 * mm, 20 * mm, 26 * mm, 16 * mm], total_row=True))
    if Decimal(tot["unspecified"]):
        story.append(Paragraph("* inclut des ventes dont le mode de paiement n'a pas été renseigné à la remise.", small))

    story.append(Paragraph("Clôtures de caisse", h2))
    if report["closures"]:
        rows = [["Date", "Clôturée par", "Ventes", "Espèces", "Carte", "En ligne", "Total clôturé", "Écart"]]
        for c in report["closures"]:
            rows.append([_fr_date(c["date"]), _txt(c["closed_by"])[:22], str(c["orders"]), _eur(c["cash"]), _eur(c["card"]), _eur(c["online"]),
                         _eur(c["total"]), _eur(c["gap"]) if Decimal(c["gap"]) else "—"])
        story.append(table(rows, [20 * mm, 34 * mm, 13 * mm, 22 * mm, 22 * mm, 22 * mm, 24 * mm, 13 * mm], align_from=2))
        story.append(Paragraph("Écart : ventes enregistrées après la clôture du jour (total des ventes du jour moins total clôturé).", small))
    else:
        story.append(Paragraph("Aucune clôture de caisse enregistrée sur la période.", body))
    if tot["days_without_closure"]:
        story.append(Paragraph(f"{tot['days_without_closure']} jour(s) d'activité sans clôture de caisse sur la période.", small))

    story.append(Spacer(1, 8))
    rate = lambda v: f"{Decimal(v).normalize():f} %".replace(".", ",")   # noqa: E731
    story.append(Paragraph(
        "Méthode — Une vente est une commande remise au client ; les commandes annulées ne sont pas comptées. Les prix sont TTC. "
        f"Taux appliqués : {rate(r['vat_rate_on_site'])} sur place, {rate(r['vat_rate_takeaway'])} à emporter et en livraison "
        f"(ventes au comptoir : {'sur place' if r['counter_is_on_site'] else 'à emporter'}), sauf taux propre à un plat. "
        "Les remises sont réparties sur les lignes au prorata ; les frais de livraison suivent le taux à emporter. "
        "La TVA est calculée par taux sur le total TTC de la période. Document de gestion à l'attention du comptable, "
        "à rapprocher des relevés bancaires et des tickets de caisse.", small))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(soft)
        canvas.drawString(20 * mm, 11 * mm, f"{app_name} — rapport comptable {_txt(report['label'])}")
        canvas.drawRightString(190 * mm, 11 * mm, f"Page {doc.page}")
        canvas.restoreState()

    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"Rapport comptable {_txt(report['label'])} — {_txt(r['name'])}", author=app_name)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()


def legal_identity(restaurant):
    """Identité légale saisie dans « Mon application » (raison sociale, numéros), si elle existe."""
    try:
        b = restaurant.branding
    except Exception:
        return {}
    return {"legal_name": b.legal_name, "company_number": b.company_number, "vat_number": b.vat_number, "legal_address": b.legal_address}


def build_documents(restaurant, d_from, d_to):
    """(rapport, PDF, tableur détaillé, nom de base des fichiers)."""
    from . import reports
    from apps.tenant.brand import brand_context
    report = accounting_report(restaurant, d_from, d_to)
    brand = brand_context(restaurant)
    pdf = render_pdf(report, {"app_name": brand.get("app_name"), "legal": legal_identity(restaurant)})
    xlsx = reports.export_xlsx(reports.export_rows(restaurant, d_from, d_to), title=f"Ventes {d_from} {d_to}")
    return report, pdf, xlsx, f"comptabilite-{restaurant.slug or 'restaurant'}-{d_from}-{d_to}"


def send_to_accountant(restaurant, d_from, d_to, to_email=None, cc_owner=True):
    """Envoie le rapport PDF et le détail des ventes (tableur) au comptable. Retourne le rapport."""
    from django.core.mail import EmailMessage
    from apps.tenant.brand import brand_context, subject as brand_subject
    to_email = (to_email or restaurant.accountant_email or "").strip()
    if not to_email:
        raise ValueError("Aucune adresse de comptable n'est renseignée.")
    report, pdf, xlsx, base = build_documents(restaurant, d_from, d_to)
    brand = brand_context(restaurant)
    t = report["totals"]
    body = "\n".join([
        "Bonjour,", "",
        f"Veuillez trouver ci-joint le rapport comptable de {restaurant.name} pour {report['label']} "
        f"(du {_fr_date(report['from'])} au {_fr_date(report['to'])}).", "",
        f"  Chiffre d'affaires TTC : {_eur(t['total'])}",
        f"  Chiffre d'affaires HT : {_eur(t['base'])}",
        f"  TVA collectée : {_eur(t['vat'])}",
        f"  Ventes : {t['orders']}", "",
        "Pièces jointes : le rapport (PDF) et le détail des ventes ligne par ligne (tableur).", "",
        brand["signature"]])
    owner_email = restaurant.owner.email if cc_owner and restaurant.owner_id else None
    msg = EmailMessage(brand_subject(f"Rapport comptable {report['label']} — {restaurant.name}", brand), body, brand["from_email"], [to_email],
                       cc=[owner_email] if owner_email and owner_email != to_email else None,
                       reply_to=[owner_email] if owner_email else None)
    msg.attach(f"{base}.pdf", pdf, "application/pdf")
    msg.attach(f"{base}.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    msg.send(fail_silently=False)
    return report
