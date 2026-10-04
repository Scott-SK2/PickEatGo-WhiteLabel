"""
python manage.py create_admin

Crée (une seule fois) le compte administrateur à partir des variables
d'environnement ADMIN_EMAIL et ADMIN_PASSWORD — pratique sur un hébergeur sans
accès shell : on ajoute les deux variables, on redéploie, puis on retire
ADMIN_PASSWORD. Sans ces variables, ou si le compte existe déjà, ne fait rien.
Avec ADMIN_RESET_PASSWORD=1, remplace aussi le mot de passe d'un compte existant
(récupération d'un accès admin perdu). Retirer ces variables ensuite.
"""
import os

from django.core.management.base import BaseCommand

from apps.accounts.models import User


class Command(BaseCommand):
    help = "Crée le compte admin depuis ADMIN_EMAIL / ADMIN_PASSWORD s'il n'existe pas"

    def handle(self, *args, **options):
        email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
        password = os.environ.get("ADMIN_PASSWORD", "")
        if not email or not password:
            self.stdout.write("create_admin : ADMIN_EMAIL / ADMIN_PASSWORD absents, rien à faire.")
            return
        user = User.objects.filter(email__iexact=email).first()
        if user:
            if os.environ.get("ADMIN_RESET_PASSWORD", "").lower() in ("1", "true", "yes"):
                if len(password) < 8:
                    self.stderr.write("create_admin : ADMIN_PASSWORD doit faire au moins 8 caractères.")
                    return
                user.set_password(password)
                user.is_active = True
                user.save(update_fields=["password", "is_active"])
                self.stdout.write(self.style.SUCCESS(f"create_admin : mot de passe de {email} réinitialisé."))
            if user.role != User.ADMIN:
                user.role, user.is_staff, user.is_superuser = User.ADMIN, True, True
                user.save(update_fields=["role", "is_staff", "is_superuser"])
                self.stdout.write(self.style.SUCCESS(f"create_admin : {email} promu administrateur."))
            else:
                self.stdout.write(f"create_admin : {email} est déjà administrateur.")
            return
        if len(password) < 8:
            self.stderr.write("create_admin : ADMIN_PASSWORD doit faire au moins 8 caractères.")
            return
        User.objects.create_superuser(email=email, password=password,
                                      first_name=os.environ.get("ADMIN_FIRST_NAME", "Admin"),
                                      last_name=os.environ.get("ADMIN_LAST_NAME", "PickEatGo"))
        self.stdout.write(self.style.SUCCESS(f"create_admin : administrateur {email} créé."))
