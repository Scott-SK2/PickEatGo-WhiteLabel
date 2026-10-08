"""restaurants/models.py"""
from decimal import Decimal
from django.db import models
from django.conf import settings
import uuid


class Restaurant(models.Model):
    PENDING   = "pending"
    ACTIVE    = "active"
    SUSPENDED = "suspended"
    STATUS_CHOICES = [
        (PENDING,   "En attente de validation"),
        (ACTIVE,    "Actif"),
        (SUSPENDED, "Suspendu"),
    ]

    CONTRACT_COMMISSION = "commission"
    CONTRACT_ABONNEMENT = "abonnement"
    CONTRACT_MIXTE      = "mixte"
    CONTRACT_CHOICES = [
        (CONTRACT_COMMISSION, "Commission"),
        (CONTRACT_ABONNEMENT, "Abonnement"),
        (CONTRACT_MIXTE,      "Mixte"),
    ]

    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner       = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="restaurant", limit_choices_to={"role": "restaurateur"}
    )
    name        = models.CharField(max_length=100)
    slug        = models.SlugField(unique=True, blank=True)
    description = models.TextField(blank=True)
    cuisine     = models.JSONField(default=list, help_text="Liste des types de cuisine ex: ['Français','Bistro / Brasserie']")
    address     = models.CharField(max_length=255)
    city        = models.CharField(max_length=100, default="Bruxelles")
    phone       = models.CharField(max_length=20)
    email       = models.EmailField(blank=True)

    # Médias
    logo        = models.ImageField(upload_to="restaurants/logos/",   max_length=255, blank=True, null=True)
    banner      = models.ImageField(upload_to="restaurants/banners/", max_length=255, blank=True, null=True)
    banner_color = models.CharField(max_length=7, default="#FF6B2C")  # fallback couleur
    emoji        = models.CharField(max_length=10, default="🍽️", help_text="Emoji affiché si pas de logo")

    # Opérationnel
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default=PENDING)
    is_open         = models.BooleanField(default=False)
    slot_interval      = models.PositiveIntegerField(default=15, help_text="Minutes entre créneaux")
    prep_time_avg      = models.PositiveIntegerField(default=15, help_text="Temps moyen de préparation (min)")
    max_orders_per_slot = models.PositiveIntegerField(null=True, blank=True, help_text="Nb max de commandes par créneau (null = illimité)")
    is_featured     = models.BooleanField(default=False)

    # Modes de commande proposés aux clients
    allow_on_site   = models.BooleanField(default=True,  help_text="Manger sur place")
    allow_pickup    = models.BooleanField(default=True,  help_text="À emporter")
    allow_delivery  = models.BooleanField(default=False, help_text="Livraison")
    # Livraison : conditions et créneaux (jours 0 = lundi … 6 = dimanche, vide = tous ; heures vides = toute la journée)
    # Frais : "fixed" = un montant unique ; "zones" = par code postal (delivery_zones)
    delivery_fee_mode   = models.CharField(max_length=10, choices=[("fixed", "Frais fixes"), ("zones", "Par zone (code postal)")], default="fixed")
    delivery_fee        = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0"))
    delivery_free_above = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, help_text="Livraison offerte à partir de ce montant d'articles")
    delivery_zones      = models.JSONField(default=list, blank=True, help_text='[{"label": "Centre", "postcodes": ["1000", "1050"], "fee": "2.50"}]')
    delivery_min_order  = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0"))
    delivery_days       = models.JSONField(default=list, blank=True)
    delivery_from       = models.TimeField(null=True, blank=True)
    delivery_until      = models.TimeField(null=True, blank=True)
    delivery_info       = models.CharField(max_length=200, blank=True, help_text="Zones desservies, délai, conditions…")

    # Programme de fidélité : après `loyalty_target` commandes récupérées, la suivante est récompensée
    loyalty_enabled      = models.BooleanField(default=False)
    loyalty_target       = models.PositiveIntegerField(default=10, help_text="Nombre de commandes pour obtenir la récompense")
    loyalty_reward_type  = models.CharField(max_length=10, choices=[("percent", "% de remise"), ("amount", "€ de remise")], default="percent")
    loyalty_reward_value = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("10.00"))

    # Tickets imprimés (mentions du ticket client)
    vat_number      = models.CharField(max_length=30, blank=True, help_text="N° de TVA imprimé sur le ticket client")
    receipt_footer  = models.CharField(max_length=200, blank=True, help_text="Message en bas du ticket client (ex. Merci et à bientôt !)")

    # Contrat
    contract_model    = models.CharField(max_length=20, choices=CONTRACT_CHOICES, default=CONTRACT_COMMISSION)
    commission_pct    = models.DecimalField(max_digits=5, decimal_places=2, default=5.00)
    monthly_fee       = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    featured_fee      = models.DecimalField(max_digits=8, decimal_places=2, default=19.00)
    admin_manages_menu = models.BooleanField(default=False)
    contract_notes    = models.TextField(blank=True)
    invoicing_day     = models.PositiveIntegerField(default=1)
    contract_paid     = models.BooleanField(default=False)

    # Stats (mis à jour via Celery)
    total_orders  = models.PositiveIntegerField(default=0)
    total_revenue = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    avg_rating    = models.DecimalField(max_digits=3, decimal_places=2, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "restaurants"
        verbose_name = "Restaurant"
        ordering = ["-is_featured", "-avg_rating", "-total_orders"]

    def __str__(self):
        return f"{self.name} ({self.get_status_display()})"

    DAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]

    # ── Ouverture effective : interrupteur du restaurateur ET horaires du jour ──
    def _today_hours(self, now):
        rows = [h for h in self.hours.all() if h.day_of_week == now.weekday()]
        return rows[0] if rows else None

    def open_state(self, now=None):
        """
        (ouvert ?, libellé) à l'instant donné, heure locale du restaurant.
        Fermé si l'interrupteur est sur « fermé », ou si les horaires du jour ne couvrent pas l'heure.
        Sans horaires configurés pour ce jour, seul l'interrupteur compte.
        """
        from django.utils import timezone
        now = timezone.localtime(now or timezone.now())
        if not self.is_open:
            return False, "Fermé"
        h = self._today_hours(now)
        if h is None:
            return True, "Ouvert"
        if not h.is_open:
            return False, "Fermé aujourd'hui"
        t = now.time()
        o, c = h.open_time, h.close_time
        fmt = lambda x: x.strftime("%H:%M")
        if c <= o:                                   # ferme après minuit (ex. 18:00 → 02:00)
            inside = t >= o or t <= c
        else:
            inside = o <= t <= c
        if inside:
            return True, f"Ouvert · ferme à {fmt(c)}"
        if t < o:
            return False, f"Fermé · ouvre à {fmt(o)}"
        return False, "Fermé · horaires terminés"

    @property
    def is_open_now(self):
        return self.open_state()[0]

    @property
    def open_status(self):
        return self.open_state()[1]

    def allows(self, order_type):
        return {"sur_place": self.allow_on_site, "emporter": self.allow_pickup, "livraison": self.allow_delivery}.get(order_type, order_type == "comptoir")

    def delivery_available_at(self, dt):
        """La livraison est-elle proposée pour ce jour et cette heure ?"""
        if not self.allow_delivery:
            return False
        if self.delivery_days and dt.weekday() not in self.delivery_days:
            return False
        t = dt.time()
        if self.delivery_from and t < self.delivery_from:
            return False
        if self.delivery_until and t > self.delivery_until:
            return False
        return True

    def delivery_quote(self, postcode, subtotal):
        """
        Frais de livraison pour ce code postal et ce sous-total → (frais, message d'erreur).
        Zones : le code postal doit appartenir à une zone ; gratuit au-delà de delivery_free_above.
        """
        fee = Decimal(self.delivery_fee or 0)
        if self.delivery_fee_mode == "zones":
            pc = "".join(ch for ch in str(postcode or "") if ch.isalnum()).upper()
            if not pc:
                return None, "Indiquez votre code postal."
            zone = next((z for z in (self.delivery_zones or [])
                         if pc in [str(x).replace(" ", "").upper() for x in (z.get("postcodes") or [])]), None)
            if zone is None:
                return None, f"Nous ne livrons pas encore le code postal {pc}."
            fee = Decimal(str(zone.get("fee", 0) or 0))
        if self.delivery_free_above is not None and Decimal(subtotal) >= self.delivery_free_above:
            fee = Decimal("0")
        return fee.quantize(Decimal("0.01")), None

    @property
    def delivery_schedule_label(self):
        parts = []
        if self.delivery_days:
            days = sorted(set(int(d) for d in self.delivery_days if 0 <= int(d) <= 6))
            if days and days == list(range(days[0], days[-1] + 1)) and len(days) > 2:
                parts.append(f"{self.DAY_SHORT[days[0]]}–{self.DAY_SHORT[days[-1]]}")
            else:
                parts.append(", ".join(self.DAY_SHORT[d] for d in days))
        if self.delivery_from or self.delivery_until:
            f = self.delivery_from.strftime("%H:%M") if self.delivery_from else "…"
            u = self.delivery_until.strftime("%H:%M") if self.delivery_until else "…"
            parts.append(f"{f}–{u}")
        return " · ".join(parts) or "tous les jours, aux heures d'ouverture"

    @property
    def monthly_due(self):
        total = Decimal("0")
        if self.contract_model in [self.CONTRACT_COMMISSION, self.CONTRACT_MIXTE]:
            total += Decimal(self.total_revenue or 0) * Decimal(self.commission_pct or 0) / Decimal("100")
        if self.contract_model in [self.CONTRACT_ABONNEMENT, self.CONTRACT_MIXTE]:
            total += Decimal(self.monthly_fee or 0)
        if self.is_featured:
            total += Decimal(self.featured_fee or 0)
        return total.quantize(Decimal("0.01"))


class BusinessHours(models.Model):
    """Horaires d'ouverture par jour de la semaine"""
    DAYS = [(i, name) for i, name in enumerate(["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"])]

    restaurant = models.ForeignKey(Restaurant, on_delete=models.CASCADE, related_name="hours")
    day_of_week = models.IntegerField(choices=DAYS)
    is_open     = models.BooleanField(default=True)
    open_time   = models.TimeField(default="11:30")
    close_time  = models.TimeField(default="14:30")

    class Meta:
        db_table = "business_hours"
        unique_together = ["restaurant", "day_of_week"]
        ordering = ["day_of_week"]

    def __str__(self):
        day = self.get_day_of_week_display()
        return f"{self.restaurant.name} — {day}: {self.open_time}–{self.close_time}"


class Report(models.Model):
    """Signalements clients/restaurants"""
    PENDING   = "pending"
    RESOLVED  = "resolved"
    DISMISSED = "dismissed"

    restaurant = models.ForeignKey(Restaurant, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports_received")
    reporter   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="reports_sent")
    target_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports_against")
    reason     = models.TextField()
    status     = models.CharField(max_length=20, default=PENDING,
                                  choices=[(PENDING,"En attente"),(RESOLVED,"Résolu"),(DISMISSED,"Classé")])
    severity   = models.CharField(max_length=10, default="medium",
                                  choices=[("low","Faible"),("medium","Moyen"),("high","Élevé")])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "reports"
        ordering = ["-created_at"]


class Employee(models.Model):
    """
    Membre de l'équipe d'un restaurant, identifié par un code PIN sur la tablette
    partagée (mode caissier). Il n'a pas de compte utilisateur : c'est le compte
    du propriétaire qui est connecté, le PIN sert à savoir qui encaisse.
    """
    CASHIER = "caissier"
    KITCHEN = "cuisine"
    MANAGER = "gerant"
    ROLE_CHOICES = [(CASHIER, "Caissier"), (KITCHEN, "Cuisine"), (MANAGER, "Gérant")]

    id            = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    restaurant    = models.ForeignKey(Restaurant, on_delete=models.CASCADE, related_name="employees")
    name          = models.CharField(max_length=80)
    role          = models.CharField(max_length=20, choices=ROLE_CHOICES, default=CASHIER)
    pin_hash      = models.CharField(max_length=128)
    is_active     = models.BooleanField(default=True)
    last_login_at = models.DateTimeField(null=True, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "employees"
        ordering = ["name"]
        verbose_name = "Employé"

    def __str__(self):
        return f"{self.name} ({self.get_role_display()})"

    def set_pin(self, pin):
        from django.contrib.auth.hashers import make_password
        self.pin_hash = make_password(str(pin))

    def check_pin(self, pin):
        from django.contrib.auth.hashers import check_password
        return check_password(str(pin), self.pin_hash)

    @property
    def is_manager(self):
        return self.role == self.MANAGER


class Favorite(models.Model):
    """Restaurant mis en favori par un client."""
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites")
    restaurant = models.ForeignKey(Restaurant, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "favorites"
        unique_together = ["user", "restaurant"]
        ordering = ["-created_at"]


def restaurant_photo_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower()
    return f"restaurants/{instance.restaurant_id}/gallery/{uuid.uuid4()}.{ext}"


class RestaurantPhoto(models.Model):
    """Photo du lieu (façade, salle, terrasse…). 10 max par restaurant ; la bannière reste Restaurant.banner."""
    MAX_PHOTOS = 10

    restaurant = models.ForeignKey(Restaurant, on_delete=models.CASCADE, related_name="gallery")
    image      = models.ImageField(upload_to=restaurant_photo_path, max_length=255)
    caption    = models.CharField(max_length=80, blank=True)
    order      = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "restaurant_photos"
        ordering = ["order", "created_at"]

    def __str__(self):
        return f"Photo de {self.restaurant.name}"
