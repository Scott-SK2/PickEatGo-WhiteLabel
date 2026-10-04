"""
Commande : python manage.py stock_digest

Envoie à chaque restaurateur un e-mail récapitulant ses plats épuisés et sous le seuil
d'alerte. À planifier chaque matin (Render → Cron Job, ou crontab) :
    0 7 * * *  python manage.py stock_digest
Sans configuration EMAIL_HOST, le message est affiché dans la console.
"""
from django.core.mail import send_mail
from django.core.management.base import BaseCommand
from apps.restaurants.models import Restaurant
from apps.menus.stock import stock_alerts, ingredient_alerts, shopping_list
from apps.tenant.brand import brand_context, subject as brand_subject
from apps.tenant.context import scope_restaurants


def _fmt(q):
    """Decimal → texte court (12.500 → 12.5)."""
    s = f"{q:f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


class Command(BaseCommand):
    help = "E-mail récapitulatif des stocks bas / épuisés (plats et ingrédients) à chaque restaurateur"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Affiche sans envoyer")

    def handle(self, *args, **options):
        sent = 0
        for restaurant in scope_restaurants(Restaurant.objects.select_related("owner").filter(status=Restaurant.ACTIVE)):
            brand = brand_context(restaurant)
            alerts = stock_alerts(restaurant)
            ing = ingredient_alerts(restaurant)
            n_alerts = len(alerts["out"]) + len(alerts["low"]) + len(ing["out"]) + len(ing["low"])
            if not n_alerts:
                continue
            lines = [f"Bonjour {restaurant.owner.first_name},", "",
                     f"État des stocks de {restaurant.name} ce matin :", ""]
            if alerts["out"]:
                lines.append("PLATS ÉPUISÉS (retirés de la carte) :")
                lines += [f"  • {i.name}" + (f" — manque : {i.limited_by}" if i.limited_by and i.portions_available == 0 else "") for i in alerts["out"]]
                lines.append("")
            if alerts["low"]:
                lines.append("PLATS BIENTÔT ÉPUISÉS :")
                lines += [f"  • {i.name} — {i.effective_stock} restant(s) (seuil {i.low_stock_threshold})"
                          + (f", limité par {i.limited_by}" if i.limited_by and i.portions_available == i.effective_stock else "")
                          for i in alerts["low"]]
                lines.append("")
            if ing["out"] or ing["low"]:
                lines.append("INGRÉDIENTS À COMMANDER :")
                for g in shopping_list(restaurant):
                    lines.append(f"  {g['supplier'].name if g['supplier'] else 'Sans fournisseur'} :")
                    lines += [f"    • {l['ingredient'].name} — reste {_fmt(l['ingredient'].stock_qty)} {l['ingredient'].get_unit_display()}, "
                              f"commander {_fmt(l['qty'])} {l['ingredient'].get_unit_display()}" for l in g["lines"]]
                lines.append("")
            lines += [f"Réapprovisionnez depuis votre tableau de bord {brand['app_name']} → Stocks.", "", brand["signature"]]
            body = "\n".join(lines)
            subject = brand_subject(f"{n_alerts} alerte(s) de stock — {restaurant.name}", brand)

            if options["dry_run"]:
                self.stdout.write(f"--- {restaurant.owner.email}\n{subject}\n{body}\n")
            else:
                send_mail(subject, body, brand["from_email"], [restaurant.owner.email], fail_silently=True)
            sent += 1
        self.stdout.write(self.style.SUCCESS(f"{sent} récapitulatif(s) {'préparé(s)' if options['dry_run'] else 'envoyé(s)'}."))
