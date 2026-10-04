"""
Commande : python manage.py weekly_report

Envoie à chaque restaurateur le bilan de la semaine écoulée (7 derniers jours)
comparé à la semaine précédente : CA, ventes, panier moyen, meilleurs produits,
meilleur jour, alertes de stock, avis sans réponse.
À planifier le lundi matin (Render → Cron Job) :  0 8 * * 1  python manage.py weekly_report
"""
from datetime import timedelta

from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.menus.stock import stock_alerts, ingredient_alerts
from apps.orders import reports
from apps.orders.models import Order
from apps.restaurants.models import Restaurant
from apps.tenant.brand import brand_context, subject as brand_subject
from apps.tenant.context import scope_restaurants


def _delta(v):
    if v is None:
        return "(pas de comparaison)"
    return f"({'+' if v >= 0 else ''}{v:.0f} % vs semaine précédente)"


class Command(BaseCommand):
    help = "Bilan hebdomadaire par e-mail à chaque restaurateur"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Affiche sans envoyer")

    def handle(self, *args, **options):
        d_to = timezone.localdate() - timedelta(days=1)
        d_from = d_to - timedelta(days=6)
        sent = 0
        for restaurant in scope_restaurants(Restaurant.objects.select_related("owner").filter(status=Restaurant.ACTIVE)):
            brand = brand_context(restaurant)
            s = reports.sales_summary(restaurant, d_from, d_to, "day")
            t, prev = s["totals"], s["previous"]
            alerts = stock_alerts(restaurant)
            ing = ingredient_alerts(restaurant)
            unanswered = (Order.objects.filter(restaurant=restaurant, client_rating__isnull=False)
                          .exclude(client_comment="").filter(owner_reply="").count())
            lines = [f"Bonjour {restaurant.owner.first_name},", "",
                     f"Votre semaine du {d_from.strftime('%d/%m')} au {d_to.strftime('%d/%m')} chez {restaurant.name} :", "",
                     f"  Chiffre d'affaires : {t['revenue']} € {_delta(prev['delta']['revenue'])}",
                     f"  Ventes : {t['orders']} {_delta(prev['delta']['orders'])} — {t['online_orders']} en ligne, {t['counter_orders']} au comptoir",
                     f"  Panier moyen : {t['avg_basket']} € {_delta(prev['delta']['avg_basket'])}",
                     f"  Articles vendus : {t['items_sold']}",
                     f"  Annulations : {t['cancelled_orders']} · Pertes déclarées : {t['waste_count']} ({t['waste_value']} €)"]
            if t.get("best_period"):
                lines.append(f"  Meilleur jour : {t['best_period']['label']} ({t['best_period']['revenue']} €, {t['best_period']['orders']} ventes)")
            if t.get("best_hour") is not None:
                lines.append(f"  Heure la plus chargée : {t['best_hour']}h")
            if float(t.get("discounts", 0)):
                lines.append(f"  Remises accordées : {t['discounts']} € sur {t['discounted_orders']} commande(s)")
            if s["by_product"]:
                lines += ["", "Top produits :"] + [f"  {i + 1}. {p['name']} — {p['qty']} vendu(s), {p['revenue']} €" for i, p in enumerate(s["by_product"][:5])]
            n_alerts = len(alerts["out"]) + len(alerts["low"]) + len(ing["out"]) + len(ing["low"])
            lines += ["", f"Stocks : {n_alerts} alerte(s)" + (f" — épuisés : {', '.join(i.name for i in alerts['out'] + ing['out'])}" if alerts["out"] or ing["out"] else "")]
            if unanswered:
                lines.append(f"Avis : {unanswered} commentaire(s) client attendent votre réponse.")
            lines += ["", f"Tout le détail dans votre tableau de bord {brand['app_name']} → Ventes.", "", brand["signature"]]
            body = "\n".join(lines)
            subject = brand_subject(f"Bilan de la semaine — {restaurant.name} : {t['revenue']} €", brand)
            if options["dry_run"]:
                self.stdout.write(f"--- {restaurant.owner.email}\n{subject}\n{body}\n")
            else:
                send_mail(subject, body, brand["from_email"], [restaurant.owner.email], fail_silently=True)
            sent += 1
        self.stdout.write(self.style.SUCCESS(f"{sent} bilan(s) {'préparé(s)' if options['dry_run'] else 'envoyé(s)'}."))
