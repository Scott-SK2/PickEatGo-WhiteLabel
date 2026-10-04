"""
notifications/push.py — envoi de notifications Web Push (VAPID).

Configuration : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_ADMIN_EMAIL (voir
`python manage.py generate_vapid_keys`). Sans clés, l'envoi est ignoré sans erreur.
L'envoi se fait dans un thread pour ne pas ralentir la requête HTTP.
"""
import json
import logging
import threading

from django.conf import settings
from django.utils import timezone

from .models import PushSubscription
from apps.tenant.brand import brand_context

log = logging.getLogger(__name__)


def push_enabled():
    return bool(getattr(settings, "VAPID_PRIVATE_KEY", "") and getattr(settings, "VAPID_PUBLIC_KEY", ""))


def _deliver(sub_ids, payload):
    from pywebpush import webpush, WebPushException
    subs = PushSubscription.objects.filter(id__in=sub_ids)
    for sub in subs:
        try:
            webpush(sub.info, data=json.dumps(payload), ttl=600,
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"})
            PushSubscription.objects.filter(pk=sub.pk).update(last_used=timezone.now())
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):          # abonnement expiré ou révoqué
                sub.delete()
            else:
                log.warning("Web Push échoué (%s) : %s", status, e)
        except Exception as e:                 # réseau, clé invalide…
            log.warning("Web Push erreur : %s", e)


def send_push(users, title, body, url="/", tag=None, sync=False):
    """Envoie une notification à tous les appareils des utilisateurs donnés."""
    if not push_enabled():
        return 0
    if not isinstance(users, (list, tuple, set)):
        users = [users]
    ids = list(PushSubscription.objects.filter(user__in=users).values_list("id", flat=True))
    if not ids:
        return 0
    brand = brand_context()
    payload = {"title": title, "body": body, "url": url, "tag": tag or "pickeatgo", "app": brand["app_name"]}
    if brand.get("icon_url"):
        payload["icon"] = brand["icon_url"]        # icône de la marque sur la notification (service worker)
    if sync:
        _deliver(ids, payload)
    else:
        threading.Thread(target=_deliver, args=(ids, payload), daemon=True).start()
    return len(ids)


# ── Messages liés aux commandes ───────────────────────────────────────────────
STATUS_MESSAGES = {
    "confirmee":  ("Commande confirmée ✅", "{resto} a confirmé votre commande #{num}. Retrait prévu à {slot}."),
    "en_cuisine": ("En préparation 👨‍🍳", "{resto} prépare votre commande #{num}."),
    "prete":      ("C'est prêt ! 🎉", "Votre commande #{num} vous attend chez {resto}."),
    "en_livraison": ("En route 🛵", "Votre commande #{num} est partie en livraison depuis {resto}."),
    "annulee":    ("Commande annulée ❌", "{resto} a annulé votre commande #{num}."),
}


def notify_order_status(order):
    """Prévient le client d'un changement de statut (si abonné)."""
    if not order.client_id:
        return 0
    msg = STATUS_MESSAGES.get(order.status)
    if not msg:
        return 0
    title, body = msg
    if order.status == "prete" and order.order_type == "livraison":
        title, body = "Commande prête 🛵", "Votre commande #{num} est prête, le livreur de {resto} part bientôt."
    ctx = {"resto": order.restaurant.name if order.restaurant else "Le restaurant", "num": order.number,
           "slot": str(order.pickup_slot)[:5] if order.pickup_slot else "—"}
    return send_push(order.client, title, body.format(**ctx), url="/", tag=f"order-{order.number}")


def notify_new_order(order):
    """Prévient le restaurateur (tous ses appareils abonnés) d'une nouvelle commande."""
    if not order.restaurant or not order.restaurant.owner_id:
        return 0
    n = sum(l.qty for l in order.items.all())
    body = f"#{order.number} · {n} article(s) · {order.total_price} € · retrait {str(order.pickup_slot)[:5]}"
    title = "Nouvelle commande 🔔"
    brand = brand_context(order.restaurant)
    if brand["mode"] == "single":
        title = f"{brand['app_name']} · Nouvelle commande 🔔"
    return send_push(order.restaurant.owner, title, body, url="/dashboard", tag=f"new-{order.number}")
