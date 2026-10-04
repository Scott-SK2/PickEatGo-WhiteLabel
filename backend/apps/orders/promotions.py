"""
orders/promotions.py — fidélité et codes promo.

Fidélité : après `loyalty_target` commandes récupérées (depuis la dernière
récompense), la commande suivante reçoit automatiquement la récompense.
Codes promo : validés puis appliqués à la création de la commande.
"""
from decimal import Decimal

from django.db.models import F
from django.utils import timezone

from .models import Order, PromoCode


def loyalty_status(restaurant, client):
    """Tampons du client chez ce restaurant et récompense prête ou non."""
    if not restaurant.loyalty_enabled or client is None:
        return {"enabled": False}
    qs = Order.objects.filter(restaurant=restaurant, client=client).exclude(order_type=Order.COUNTER)
    last_reward = qs.filter(loyalty_reward=True).exclude(status=Order.CANCELLED).order_by("-created_at").first()
    stamps_qs = qs.filter(status=Order.PICKED_UP)
    if last_reward:
        stamps_qs = stamps_qs.filter(created_at__gt=last_reward.created_at)
    stamps = min(stamps_qs.count(), restaurant.loyalty_target)
    pending_reward = qs.filter(loyalty_reward=True).exclude(status__in=[Order.CANCELLED, Order.PICKED_UP]).exists()
    return {
        "enabled": True, "stamps": stamps, "target": restaurant.loyalty_target,
        "reward_ready": stamps >= restaurant.loyalty_target and not pending_reward,
        "reward_label": reward_label(restaurant),
        "reward_type": restaurant.loyalty_reward_type, "reward_value": str(restaurant.loyalty_reward_value),
    }


def reward_label(restaurant):
    v = restaurant.loyalty_reward_value
    return f"-{v:.0f} % fidélité" if restaurant.loyalty_reward_type == "percent" else f"-{v:.2f} € fidélité"


def reward_discount(restaurant, subtotal):
    v = restaurant.loyalty_reward_value
    d = subtotal * v / Decimal("100") if restaurant.loyalty_reward_type == "percent" else v
    return max(Decimal("0"), min(d, subtotal)).quantize(Decimal("0.01"))


def validate_promo(restaurant, code, subtotal):
    """(PromoCode, discount) ou lève ValueError avec un message lisible."""
    code = (code or "").strip().upper()
    if not code:
        raise ValueError("Indiquez un code.")
    promo = PromoCode.objects.filter(restaurant=restaurant, code__iexact=code).first()
    if promo is None:
        raise ValueError("Code inconnu.")
    err = promo.validate_for(Decimal(subtotal), timezone.localdate())
    if err:
        raise ValueError(err)
    return promo, promo.discount_for(Decimal(subtotal))


def apply_discounts(order, promo_code=None, use_loyalty=True):
    """
    Applique au plus une remise (code promo prioritaire, sinon récompense fidélité prête)
    et met à jour total_price. `order.total_price` doit contenir le sous-total.
    """
    subtotal = order.total_price
    discount, label = Decimal("0"), ""
    if promo_code:
        promo, discount = validate_promo(order.restaurant, promo_code, subtotal)   # peut lever ValueError
        label = f"Code {promo.code} ({promo.label})"
        order.promo_code = promo
        from django.db.models import Q
        updated = PromoCode.objects.filter(Q(max_uses__isnull=True) | Q(uses__lt=F("max_uses")), pk=promo.pk).update(uses=F("uses") + 1)
        if not updated:
            raise ValueError("Ce code a atteint son nombre maximal d'utilisations.")
    elif use_loyalty and order.client_id and order.restaurant.loyalty_enabled:
        st = loyalty_status(order.restaurant, order.client)
        if st.get("reward_ready"):
            discount = reward_discount(order.restaurant, subtotal)
            label = f"Récompense fidélité ({reward_label(order.restaurant)})"
            order.loyalty_reward = True
    order.discount_amount = discount
    order.discount_label = label
    order.total_price = (subtotal - discount).quantize(Decimal("0.01"))
    order.save(update_fields=["discount_amount", "discount_label", "promo_code", "loyalty_reward", "total_price"])
    return order


def release_promo(order):
    """Une commande annulée rend son utilisation du code promo."""
    if order.promo_code_id:
        PromoCode.objects.filter(pk=order.promo_code_id, uses__gt=0).update(uses=F("uses") - 1)
