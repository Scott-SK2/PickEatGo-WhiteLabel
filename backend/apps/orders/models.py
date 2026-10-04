"""orders/models.py"""
from decimal import Decimal
from django.db import models
from django.conf import settings
import uuid


class PromoCode(models.Model):
    """Code promotionnel d'un restaurant (pourcentage ou montant), avec validité et quota."""
    PERCENT = "percent"
    AMOUNT  = "amount"
    KIND_CHOICES = [(PERCENT, "% de remise"), (AMOUNT, "€ de remise")]

    restaurant  = models.ForeignKey("restaurants.Restaurant", on_delete=models.CASCADE, related_name="promo_codes")
    code        = models.CharField(max_length=30)
    kind        = models.CharField(max_length=10, choices=KIND_CHOICES, default=PERCENT)
    value       = models.DecimalField(max_digits=8, decimal_places=2)
    min_order   = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0"), help_text="Montant minimum du panier")
    starts_at   = models.DateField(null=True, blank=True)
    ends_at     = models.DateField(null=True, blank=True)
    max_uses    = models.PositiveIntegerField(null=True, blank=True, help_text="Nombre d'utilisations max (vide = illimité)")
    uses        = models.PositiveIntegerField(default=0)
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "promo_codes"
        unique_together = ["restaurant", "code"]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} ({self.label})"

    @property
    def label(self):
        return f"-{self.value:.0f} %" if self.kind == self.PERCENT else f"-{self.value:.2f} €"

    def discount_for(self, subtotal):
        d = subtotal * self.value / Decimal("100") if self.kind == self.PERCENT else self.value
        return max(Decimal("0"), min(d, subtotal)).quantize(Decimal("0.01"))

    def validate_for(self, subtotal, today):
        """Retourne un message d'erreur si le code n'est pas utilisable, sinon None."""
        if not self.is_active:
            return "Ce code n'est plus actif."
        if self.starts_at and today < self.starts_at:
            return "Ce code n'est pas encore valable."
        if self.ends_at and today > self.ends_at:
            return "Ce code a expiré."
        if self.max_uses is not None and self.uses >= self.max_uses:
            return "Ce code a atteint son nombre maximum d'utilisations."
        if subtotal < self.min_order:
            return f"Ce code s'applique à partir de {self.min_order:.2f} € de commande."
        return None


class Order(models.Model):
    NEW        = "nouvelle"
    CONFIRMED  = "confirmee"
    COOKING    = "en_cuisine"
    READY      = "prete"
    DELIVERING = "en_livraison"
    PICKED_UP  = "recuperee"
    CANCELLED  = "annulee"

    STATUS_CHOICES = [
        (NEW,       "Nouvelle"),
        (CONFIRMED, "Confirmée"),
        (COOKING,   "En cuisine"),
        (READY,     "Prête"),
        (DELIVERING,"En livraison"),
        (PICKED_UP, "Récupérée"),
        (CANCELLED, "Annulée"),
    ]
    PICKUP     = "emporter"
    ON_SITE    = "sur_place"
    DELIVERY   = "livraison"
    COUNTER    = "comptoir"      # vente encaissée directement au comptoir (hors ligne)
    TYPE_CHOICES = [(PICKUP,"À emporter"),(ON_SITE,"Sur place"),(DELIVERY,"Livraison"),(COUNTER,"Comptoir")]

    PAY_CASH   = "especes"
    PAY_CARD   = "carte"
    PAY_ONLINE = "en_ligne"
    PAYMENT_CHOICES = [(PAY_CASH,"Espèces"),(PAY_CARD,"Carte"),(PAY_ONLINE,"En ligne")]

    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number      = models.CharField(max_length=10, unique=True, editable=False)  # ex: #4521
    client      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, related_name="orders")
    restaurant  = models.ForeignKey("restaurants.Restaurant", on_delete=models.SET_NULL,
                                    null=True, related_name="orders")
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default=NEW)
    order_type  = models.CharField(max_length=20, choices=TYPE_CHOICES, default=PICKUP)
    pickup_slot = models.TimeField()
    pickup_date = models.DateField()
    note        = models.TextField(blank=True)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)
    # Remises : total_price est le montant payé (sous-total − remise)
    discount_amount = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0"))
    discount_label  = models.CharField(max_length=80, blank=True)
    promo_code      = models.ForeignKey(PromoCode, on_delete=models.SET_NULL, null=True, blank=True, related_name="orders")
    loyalty_reward  = models.BooleanField(default=False, help_text="Commande récompensée par le programme de fidélité")
    # Livraison : adresse du client et frais (inclus dans total_price)
    delivery_address = models.CharField(max_length=255, blank=True)
    delivery_postcode = models.CharField(max_length=10, blank=True)
    delivery_fee     = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0"))
    # Gestion : mode de paiement (renseigné à l'encaissement) et auteur d'une vente comptoir
    payment_method = models.CharField(max_length=20, choices=PAYMENT_CHOICES, blank=True, default="")
    created_by  = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="recorded_orders", help_text="Compte connecté ayant encaissé (vente comptoir)")
    employee    = models.ForeignKey("restaurants.Employee", on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="orders", help_text="Employé (PIN) ayant encaissé ou remis la commande")
    client_rating  = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-5
    client_comment = models.TextField(blank=True)
    rated_at       = models.DateTimeField(null=True, blank=True)
    owner_reply    = models.TextField(blank=True, help_text="Réponse publique du restaurateur à l'avis")
    owner_reply_at = models.DateTimeField(null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "orders"
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if self.number:
            return super().save(*args, **kwargs)
        # Numéro = plus grand numéro existant + 1 (count()+1 entrait en collision après une suppression
        # ou lors de deux commandes simultanées). En cas de collision, on réessaie avec le suivant.
        from django.db import IntegrityError, transaction
        from django.db.models import Max
        from django.db.models.functions import Cast
        for attempt in range(8):
            last = Order.objects.aggregate(m=Max(Cast("number", models.IntegerField())))["m"] or 4500
            self.number = str(last + 1 + attempt)
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError:
                if attempt == 7:
                    raise
                self.number = ""

    def __str__(self):
        return f"#{self.number} — {self.restaurant} — {self.get_status_display()}"

    @property
    def subtotal(self):
        """Montant des articles, avant remise et hors frais de livraison."""
        return self.total_price + self.discount_amount - self.delivery_fee

    @property
    def can_advance(self):
        return self.status not in [self.PICKED_UP, self.CANCELLED]

    TRANSITIONS = {
        NEW: CONFIRMED, CONFIRMED: COOKING, COOKING: READY, READY: PICKED_UP, DELIVERING: PICKED_UP,
    }

    @property
    def next_status(self):
        """Une livraison passe par « En livraison » entre « Prête » et « Récupérée » (livrée)."""
        if self.status == self.READY and self.order_type == self.DELIVERY:
            return self.DELIVERING
        return self.TRANSITIONS.get(self.status)

    def advance_status(self):
        next_status = self.next_status
        if next_status:
            self.status = next_status
            self.save(update_fields=["status", "updated_at"])
        return self.status


class OrderItem(models.Model):
    order    = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    menu_item = models.ForeignKey("menus.MenuItem", on_delete=models.SET_NULL, null=True)
    name     = models.CharField(max_length=100)   # snapshot au moment de la commande
    price    = models.DecimalField(max_digits=8, decimal_places=2)
    qty      = models.PositiveIntegerField(default=1)
    options  = models.JSONField(default=list)      # snapshot des options choisies

    class Meta:
        db_table = "order_items"

    def __str__(self):
        return f"{self.qty}× {self.name} ({self.order.number})"

    @property
    def subtotal(self):
        return self.price * self.qty


class DailyClosure(models.Model):
    """
    Clôture de journée (« Z de caisse ») : photographie figée des ventes d'un jour.
    Générée par le restaurateur en fin de service, elle sert de référence comptable.
    """
    restaurant  = models.ForeignKey("restaurants.Restaurant", on_delete=models.CASCADE, related_name="closures")
    date        = models.DateField()
    closed_by   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    note        = models.TextField(blank=True)

    orders_count      = models.PositiveIntegerField(default=0)
    items_count       = models.PositiveIntegerField(default=0)
    total             = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_cash        = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_card        = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_online      = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_unspecified = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    online_orders     = models.PositiveIntegerField(default=0)
    counter_orders    = models.PositiveIntegerField(default=0)
    cancelled_orders  = models.PositiveIntegerField(default=0)
    waste_count       = models.PositiveIntegerField(default=0)
    waste_value       = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    items_summary     = models.JSONField(default=list, help_text="[{name, qty, revenue}] — plats vendus ce jour")
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "daily_closures"
        ordering = ["-date"]
        unique_together = ["restaurant", "date"]
        verbose_name = "Clôture de journée"

    def __str__(self):
        return f"Clôture {self.restaurant} — {self.date} ({self.total} €)"
