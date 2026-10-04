"""
python manage.py bootstrap_tenant --name "Burger House" --email marie@burgerhouse.be [--password …]
                                  [--address "12 Rue de la Paix, Bruxelles"] [--city Bruxelles] [--phone "+32 2 …"]
                                  [--first-name Marie] [--last-name Dupont] [--cuisine Américain --cuisine Burger]

Amorce une instance mono-restaurant en une fois : le compte restaurateur, le restaurant
(actif, interrupteur fermé), les quatre catégories par défaut, les horaires par défaut
(lundi–vendredi 11:30–22:00, week-end 11:30–22:30), la marque par défaut, puis affiche
l'identifiant à placer dans TENANT_RESTAURANT_ID.

Idempotent : si le compte existe déjà avec un restaurant, la commande affiche simplement
l'identifiant existant. Sans --password, un mot de passe initial est généré et affiché une fois.
"""
import re
import secrets
import uuid

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.menus.models import Category
from apps.restaurants.models import BusinessHours, Restaurant
from apps.tenant.models import Branding

DEFAULT_CATEGORIES = ["Entrées", "Plats", "Desserts", "Boissons"]


def _slug(name):
    base = re.sub(r"[^a-z0-9-]", "", name.lower().replace(" ", "-")).strip("-")
    return (base + "-" if base else "") + str(uuid.uuid4())[:8]


class Command(BaseCommand):
    help = "Crée le compte restaurateur, le restaurant, les catégories, les horaires et la marque d'une instance mono-restaurant"
    requires_system_checks = []     # l'identifiant n'existe pas encore : les vérifications tenant.* seraient bloquantes

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True, help="Nom du restaurant (et de l'application par défaut)")
        parser.add_argument("--email", required=True, help="E-mail du compte restaurateur")
        parser.add_argument("--password", default="", help="Mot de passe initial (généré si absent)")
        parser.add_argument("--first-name", default="")
        parser.add_argument("--last-name", default="")
        parser.add_argument("--address", default="")
        parser.add_argument("--city", default="Bruxelles")
        parser.add_argument("--phone", default="")
        parser.add_argument("--cuisine", action="append", default=[], help="Type de cuisine (répétable)")
        parser.add_argument("--open", action="store_true", help="Positionne l'interrupteur sur « ouvert » dès la création")
        parser.add_argument("--restaurant-id", default="", help="UUID imposé au restaurant (outillage : TENANT_RESTAURANT_ID choisi avant le déploiement)")
        parser.add_argument("--skip-migrate", action="store_true", help="Ne lance pas les migrations avant l'amorçage")

    def handle(self, *args, **o):
        if not o["skip_migrate"]:
            call_command("migrate", interactive=False, verbosity=0, skip_checks=True)
        with transaction.atomic():
            self._bootstrap(o)

    def _bootstrap(self, o):
        email = o["email"].strip().lower()
        name = o["name"].strip()
        if not name:
            raise CommandError("Le nom du restaurant est obligatoire.")
        generated = None
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            password = o["password"] or secrets.token_urlsafe(10)
            generated = None if o["password"] else password
            if len(password) < 8:
                raise CommandError("Le mot de passe doit faire au moins 8 caractères.")
            user = User.objects.create_user(
                email=email, password=password, role=User.RESTAURATEUR,
                first_name=o["first_name"] or name.split(" ")[0][:80], last_name=o["last_name"] or "Restaurateur",
                phone=o["phone"][:20], is_verified=True,
            )
            self.stdout.write(f"Compte restaurateur créé : {email}")
        else:
            if user.role != User.RESTAURATEUR:
                user.role = User.RESTAURATEUR
                user.save(update_fields=["role"])
            self.stdout.write(f"Compte restaurateur existant : {email}")

        forced_id = None
        if o["restaurant_id"]:
            try:
                forced_id = uuid.UUID(o["restaurant_id"])
            except ValueError:
                raise CommandError("--restaurant-id doit être un UUID.")
        restaurant = Restaurant.objects.filter(owner=user).first()
        if restaurant is None and forced_id and Restaurant.objects.filter(pk=forced_id).exists():
            raise CommandError(f"L'identifiant {forced_id} est déjà utilisé par un autre restaurant.")
        if restaurant is None:
            restaurant = Restaurant.objects.create(
                **({"id": forced_id} if forced_id else {}),
                owner=user, name=name[:100], slug=_slug(name), cuisine=o["cuisine"] or [],
                address=o["address"][:255], city=o["city"][:100] or "Bruxelles", phone=o["phone"][:20],
                status=Restaurant.ACTIVE, is_open=bool(o["open"]),
            )
            self.stdout.write(f"Restaurant créé : {restaurant.name}")
        else:
            if forced_id and restaurant.pk != forced_id:
                raise CommandError(f"Ce compte possède déjà le restaurant {restaurant.pk} ; --restaurant-id {forced_id} ne peut pas s'appliquer.")
            if restaurant.status != Restaurant.ACTIVE:
                restaurant.status = Restaurant.ACTIVE
                restaurant.save(update_fields=["status"])
            self.stdout.write(f"Restaurant existant : {restaurant.name}")

        if not Category.objects.filter(restaurant=restaurant).exists():
            for i, n in enumerate(DEFAULT_CATEGORIES):
                Category.objects.create(restaurant=restaurant, name=n, order=i)
            self.stdout.write("Catégories par défaut créées : " + ", ".join(DEFAULT_CATEGORIES))
        if not BusinessHours.objects.filter(restaurant=restaurant).exists():
            for d in range(7):
                BusinessHours.objects.create(restaurant=restaurant, day_of_week=d, is_open=True,
                                             open_time="11:30", close_time="22:30" if d >= 5 else "22:00")
            self.stdout.write("Horaires par défaut créés (11:30–22:00, week-end jusqu'à 22:30)")
        brand = Branding.for_restaurant(restaurant)
        self.stdout.write(f"Marque par défaut : « {brand.app_name} » (nom court « {brand.short_name} »)")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Instance amorcée. Ajoutez ces variables au service API puis redéployez :"))
        self.stdout.write("  APP_MODE=single")
        self.stdout.write(f"  TENANT_RESTAURANT_ID={restaurant.id}")
        if generated:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(f"Mot de passe initial de {email} : {generated}  (à transmettre au restaurateur, puis à changer)"))
