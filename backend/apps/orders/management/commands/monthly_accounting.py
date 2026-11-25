"""
Commande : python manage.py monthly_accounting [--month YYYY-MM] [--dry-run]

Envoie au comptable de chaque restaurant le rapport comptable du mois écoulé : PDF (journal des ventes,
TVA par taux, modes de paiement, clôtures de caisse) et détail des ventes en tableur. Le restaurateur est en copie.
Ne concerne que les restaurants qui ont renseigné l'adresse du comptable et activé l'envoi automatique
(Paramètres → Comptabilité).
À planifier le 1er du mois (Render → Cron Job) :  0 6 1 * *  python manage.py monthly_accounting
"""
from django.core.management.base import BaseCommand, CommandError

from apps.orders import accounting
from apps.restaurants.models import Restaurant
from apps.tenant.context import scope_restaurants


class Command(BaseCommand):
    help = "Rapport comptable mensuel envoyé au comptable de chaque restaurant"

    def add_arguments(self, parser):
        parser.add_argument("--month", default="", help="Mois à envoyer, YYYY-MM (défaut : le mois précédent)")
        parser.add_argument("--dry-run", action="store_true", help="Affiche sans envoyer")

    def handle(self, *args, **options):
        try:
            d_from, d_to = accounting.month_range(options["month"] or None)
        except (ValueError, TypeError):
            raise CommandError("--month attend le format YYYY-MM, par exemple 2026-10.")
        qs = scope_restaurants(Restaurant.objects.select_related("owner").filter(status=Restaurant.ACTIVE, accounting_auto_send=True).exclude(accountant_email=""))
        sent = 0
        for restaurant in qs:
            if options["dry_run"]:
                t = accounting.accounting_report(restaurant, d_from, d_to)["totals"]
                self.stdout.write(f"--- {restaurant.name} → {restaurant.accountant_email} : {accounting.period_label(d_from, d_to)}, "
                                  f"{t['orders']} vente(s), {t['total']} € TTC, TVA {t['vat']} €")
                continue
            try:
                accounting.send_to_accountant(restaurant, d_from, d_to)
                sent += 1
            except Exception as e:
                self.stderr.write(f"{restaurant.name} : envoi impossible ({e})")
        self.stdout.write(self.style.SUCCESS(f"{sent} rapport(s) comptable(s) envoyé(s) pour {accounting.period_label(d_from, d_to)}."))
