"""
notifications/emails.py — e-mails transactionnels (confirmation de commande,
commande prête, réinitialisation de mot de passe).

Sans EMAIL_HOST, Django affiche les messages dans la console. L'envoi lié aux
commandes se fait dans un thread (EMAIL_SYNC=True force l'envoi immédiat, utile en test).

Marque : chaque message est signé du nom de l'application (contexte « brand ») : PickEatGo
en mode plateforme, le nom du restaurant en mode mono-restaurant, avec la mention
« propulsé par PickEatGo » selon le réglage POWERED_BY_BADGE.
"""
import logging
import threading

from django.conf import settings
from django.core.mail import send_mail

from apps.tenant.brand import brand_context, subject as brand_subject

log = logging.getLogger(__name__)


def _send(subject, body, to, sync=None, from_email=None):
    if not to:
        return
    if sync is None:
        sync = getattr(settings, "EMAIL_SYNC", False)
    sender = from_email or settings.DEFAULT_FROM_EMAIL

    def run():
        try:
            send_mail(subject, body, sender, [to], fail_silently=True)
        except Exception as e:      # SMTP indisponible : on ne bloque jamais la commande
            log.warning("E-mail non envoyé (%s) : %s", subject, e)

    if sync:
        run()
    else:
        threading.Thread(target=run, daemon=True).start()


def _order_lines(order):
    return "\n".join(f"  {l.qty}× {l.name} — {l.price * l.qty:.2f} €" for l in order.items.all())


def _ctx(order=None):
    """Contexte de marque ; en mode single le restaurant de la commande est celui de l'instance."""
    return brand_context(order.restaurant if order is not None and order.restaurant_id else None)


def order_confirmation(order):
    """Récapitulatif envoyé au client dès la commande passée."""
    if not order.client or not order.client.email:
        return
    brand = _ctx(order)
    resto = order.restaurant.name if order.restaurant else "le restaurant"
    lines = [f"Bonjour {order.client.first_name},", "",
             f"Votre commande #{order.number} chez {resto} est enregistrée.",
             (f"Livraison prévue vers {str(order.pickup_slot)[:5]} à : {order.delivery_address}." if order.order_type == "livraison"
              else f"Retrait prévu à {str(order.pickup_slot)[:5]} ({'sur place' if order.order_type == 'sur_place' else 'à emporter'})."), "",
             _order_lines(order)]
    if order.discount_amount:
        lines += [f"  {order.discount_label} : −{order.discount_amount:.2f} €"]
    if order.delivery_fee:
        lines += [f"  Frais de livraison : {order.delivery_fee:.2f} €"]
    lines += [f"  Total : {order.total_price:.2f} €", ""]
    if order.note:
        lines += [f"Votre note : {order.note}", ""]
    lines += [f"Vous recevrez un e-mail quand elle sera prête. Suivi en direct sur {brand['app_name']}.", "", "Bon appétit !", brand["signature"]]
    _send(brand_subject(f"Commande #{order.number} enregistrée — {resto}", brand), "\n".join(lines), order.client.email,
          from_email=brand["from_email"])


def order_ready(order):
    if not order.client or not order.client.email:
        return
    brand = _ctx(order)
    resto = order.restaurant.name if order.restaurant else "le restaurant"
    addr = f"{order.restaurant.address}" if order.restaurant and order.restaurant.address else ""
    body = (f"Bonjour {order.client.first_name},\n\n"
            f"Votre commande #{order.number} est prête chez {resto}.\n"
            + (f"Adresse : {addr}\n" if addr else "")
            + f"\nÀ tout de suite !\n{brand['signature']}")
    _send(brand_subject(f"Votre commande #{order.number} est prête 🎉", brand), body, order.client.email, from_email=brand["from_email"])


def password_reset(user, link):
    brand = brand_context()
    body = (f"Bonjour {user.first_name},\n\n"
            f"Vous avez demandé à réinitialiser votre mot de passe {brand['app_name']}.\n"
            f"Cliquez sur ce lien (valable quelques heures) :\n\n{link}\n\n"
            f"Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.\n\n{brand['signature']}")
    _send(brand_subject("Réinitialisation de votre mot de passe", brand), body, user.email, sync=True, from_email=brand["from_email"])
