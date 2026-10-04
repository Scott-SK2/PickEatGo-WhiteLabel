"""
python manage.py generate_vapid_keys

Génère une paire de clés VAPID pour les notifications push. À exécuter une seule
fois, puis copier les deux valeurs dans les variables d'environnement du backend
(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) avec VAPID_ADMIN_EMAIL.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Génère une paire de clés VAPID (Web Push)"

    def handle(self, *args, **options):
        from cryptography.hazmat.primitives import serialization
        from py_vapid import Vapid
        from py_vapid.utils import b64urlencode
        v = Vapid()
        v.generate_keys()
        private = b64urlencode(v.private_key.private_numbers().private_value.to_bytes(32, "big"))
        public = b64urlencode(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        self.stdout.write("Ajoutez ces variables d'environnement au backend :\n")
        self.stdout.write(f"VAPID_PUBLIC_KEY={public}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private}")
        self.stdout.write("VAPID_ADMIN_EMAIL=contact@votredomaine.be")
