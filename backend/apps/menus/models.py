"""
menus/models.py
Modèles : Category → MenuItem → MenuItemOption
Supporte l'upload photo via Cloudinary
"""
from decimal import Decimal
from django.db import models
from django.conf import settings
import uuid

STOCK_REASON_CHOICES = [
    ("vente",      "Vente"),
    ("reappro",    "Réapprovisionnement"),
    ("perte",      "Perte / invendu"),
    ("inventaire", "Inventaire"),
    ("annulation", "Annulation de commande"),
    ("ajustement", "Ajustement"),
]


class Category(models.Model):
    """Catégorie de menu (ex: Burgers, Sides, Boissons)"""
    restaurant  = models.ForeignKey("restaurants.Restaurant", on_delete=models.CASCADE, related_name="categories")
    name        = models.CharField(max_length=80)
    description = models.CharField(max_length=200, blank=True)
    order       = models.PositiveIntegerField(default=0, help_text="Ordre d'affichage")
    is_active   = models.BooleanField(default=True)

    class Meta:
        db_table = "menu_categories"
        ordering = ["order", "name"]
        unique_together = ["restaurant", "name"]
        verbose_name = "Catégorie"

    def __str__(self):
        return f"{self.restaurant.name} → {self.name}"


def menu_item_image_path(instance, filename):
    """Chemin Cloudinary : menus/{restaurant_id}/{uuid}.ext"""
    ext = filename.rsplit(".", 1)[-1].lower()
    return f"menus/{instance.category.restaurant_id}/{uuid.uuid4()}.{ext}"


class MenuItem(models.Model):
    """Plat du menu"""
    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category    = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="items")
    name        = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    price       = models.DecimalField(max_digits=8, decimal_places=2)

    # ── Photo ──────────────────────────────────────────────────────────────────
    # Stockée sur Cloudinary via cloudinary_storage
    # Format accepté : JPEG, PNG, WebP — max 5MB (contrôlé côté view)
    image       = models.ImageField(
        upload_to=menu_item_image_path,
        max_length=255,                      # identifiant Cloudinary : dossier d'instance + restaurant + fichier
        blank=True,
        null=True,
        help_text="Photo du plat (JPEG/PNG/WebP, max 5 MB)"
    )
    image_alt   = models.CharField(max_length=150, blank=True, help_text="Texte alternatif pour l'accessibilité")

    # Disponibilité
    is_available = models.BooleanField(default=True)
    is_featured  = models.BooleanField(default=False)  # mis en avant sur la carte

    # ── Gestion : stock et coût ────────────────────────────────────────────────
    # stock_qty vide = stock non suivi (plat toujours disponible tant que is_available)
    cost_price          = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True,
                                              help_text="Prix de revient (coût matière) — sert au calcul de la marge")
    stock_qty           = models.IntegerField(null=True, blank=True, help_text="Quantité en stock. Vide = stock non suivi")
    low_stock_threshold = models.PositiveIntegerField(default=5, help_text="Alerte quand le stock atteint ce seuil")
    auto_disabled       = models.BooleanField(default=False, help_text="Rendu indisponible automatiquement (stock épuisé)")

    # ── Disponibilité programmée ───────────────────────────────────────────────
    # available_days : jours (0 = lundi … 6 = dimanche), vide = tous les jours
    # available_from / until : plage horaire (ex. 11:30–14:00), vide = toute la journée
    # available_on : date unique (plat du jour), vide = pas de restriction de date
    available_days  = models.JSONField(default=list, blank=True)
    available_from  = models.TimeField(null=True, blank=True)
    available_until = models.TimeField(null=True, blank=True)
    available_on    = models.DateField(null=True, blank=True, help_text="Plat du jour : disponible uniquement ce jour-là")

    # Infos nutritionnelles (optionnel)
    allergens    = models.CharField(max_length=255, blank=True, help_text="Ex: gluten, lactose, arachides")
    calories     = models.PositiveIntegerField(null=True, blank=True)

    order        = models.PositiveIntegerField(default=0)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "menu_items"
        ordering = ["order", "name"]
        verbose_name = "Plat"

    def __str__(self):
        return f"{self.name} — {self.price} €"

    @property
    def restaurant(self):
        return self.category.restaurant

    @property
    def image_url(self):
        """Retourne l'URL Cloudinary ou None"""
        return self.image.url if self.image else None

    @property
    def track_stock(self):
        """Stock compté à l'unité de plat (indépendant de la recette)."""
        return self.stock_qty is not None

    # ── Recette : portions réalisables à partir des ingrédients ───────────────
    def _recipe_limit(self):
        """(portions, ingrédient limitant) ou (None, None) si le plat n'a pas de recette."""
        lines = [l for l in self.recipe.all() if l.qty and l.qty > 0]   # utilise le prefetch s'il existe
        if not lines:
            return None, None
        best, limiting = None, None
        for line in lines:
            portions = int(line.ingredient.stock_qty // line.qty) if line.ingredient.stock_qty > 0 else 0
            if best is None or portions < best:
                best, limiting = portions, line.ingredient
        return max(0, best), limiting

    @property
    def has_recipe(self):
        return self._recipe_limit()[0] is not None

    @property
    def portions_available(self):
        return self._recipe_limit()[0]

    @property
    def limited_by(self):
        ing = self._recipe_limit()[1]
        return ing.name if ing else None

    @property
    def effective_stock(self):
        """Nombre de plats réellement vendables : min(stock du plat, portions par la recette). None = illimité."""
        values = []
        if self.stock_qty is not None:
            values.append(self.stock_qty)
        portions = self.portions_available
        if portions is not None:
            values.append(portions)
        return min(values) if values else None

    @property
    def is_out_of_stock(self):
        es = self.effective_stock
        return es is not None and es <= 0

    @property
    def is_low_stock(self):
        es = self.effective_stock
        return es is not None and 0 < es <= self.low_stock_threshold

    # ── Disponibilité programmée ───────────────────────────────────────────────
    DAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]

    @property
    def is_scheduled(self):
        return bool(self.available_days) or self.available_from is not None or self.available_until is not None or self.available_on is not None

    def is_available_on_date(self, d):
        if self.available_on is not None and d != self.available_on:
            return False
        if self.available_days and d.weekday() not in self.available_days:
            return False
        return True

    def is_available_at(self, dt):
        """dt : datetime local (date + heure de retrait)."""
        if not self.is_available_on_date(dt.date()):
            return False
        t = dt.time()
        if self.available_from and t < self.available_from:
            return False
        if self.available_until and t > self.available_until:
            return False
        return True

    @property
    def is_available_now(self):
        from django.utils import timezone
        return self.is_available and self.is_available_at(timezone.localtime())

    @property
    def is_available_today(self):
        from django.utils import timezone
        return self.is_available_on_date(timezone.localdate())

    @property
    def schedule_label(self):
        """Texte court : « Plat du jour 21/09 », « Lun–Ven · 11:30–14:00 »…"""
        parts = []
        if self.available_on is not None:
            parts.append(f"Plat du jour {self.available_on.strftime('%d/%m')}")
        elif self.available_days:
            days = sorted(set(int(d) for d in self.available_days if 0 <= int(d) <= 6))
            if days and days == list(range(days[0], days[-1] + 1)) and len(days) > 2:
                parts.append(f"{self.DAY_SHORT[days[0]]}–{self.DAY_SHORT[days[-1]]}")
            else:
                parts.append(", ".join(self.DAY_SHORT[d] for d in days))
        if self.available_from or self.available_until:
            f = self.available_from.strftime("%H:%M") if self.available_from else "…"
            u = self.available_until.strftime("%H:%M") if self.available_until else "…"
            parts.append(f"{f}–{u}")
        return " · ".join(parts) or None

    @property
    def recipe_cost(self):
        """Coût matière calculé depuis la recette (None sans recette)."""
        lines = list(self.recipe.all())
        if not lines:
            return None
        return sum((line.qty * line.ingredient.unit_cost for line in lines), Decimal("0"))


def menu_item_photo_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower()
    return f"menus/{instance.item.category.restaurant_id}/{instance.item_id}/{uuid.uuid4()}.{ext}"


class MenuItemPhoto(models.Model):
    """Photo supplémentaire d'un plat (la photo principale reste MenuItem.image). 5 photos max par plat."""
    MAX_PHOTOS = 5

    item       = models.ForeignKey(MenuItem, on_delete=models.CASCADE, related_name="photos")
    image      = models.ImageField(upload_to=menu_item_photo_path, max_length=255)
    order      = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "menu_item_photos"
        ordering = ["order", "created_at"]

    def __str__(self):
        return f"Photo de {self.item.name}"


class MenuItemOption(models.Model):
    """Options d'un plat (ex: 'Fromage +0.5€', 'Sans oignons')"""
    item        = models.ForeignKey(MenuItem, on_delete=models.CASCADE, related_name="options")
    label       = models.CharField(max_length=100)
    extra_price = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    is_default  = models.BooleanField(default=False)

    class Meta:
        db_table = "menu_item_options"
        ordering = ["extra_price", "label"]

    def __str__(self):
        price_str = f" +{self.extra_price}€" if self.extra_price > 0 else ""
        return f"{self.label}{price_str}"


class StockMovement(models.Model):
    """
    Journal des mouvements de stock d'un plat (audit).
    Chaque variation (vente, réapprovisionnement, perte, inventaire, annulation)
    est tracée avec son auteur, la commande liée et le stock résultant.
    """
    SALE      = "vente"
    RESTOCK   = "reappro"
    WASTE     = "perte"
    INVENTORY = "inventaire"
    CANCEL    = "annulation"
    ADJUST    = "ajustement"
    REASON_CHOICES = STOCK_REASON_CHOICES

    item       = models.ForeignKey(MenuItem, on_delete=models.CASCADE, related_name="stock_movements")
    delta      = models.IntegerField(help_text="Variation (+ entrée / − sortie)")
    qty_after  = models.IntegerField(null=True, blank=True, help_text="Stock après le mouvement (vide si stock non suivi)")
    reason     = models.CharField(max_length=20, choices=REASON_CHOICES)
    order      = models.ForeignKey("orders.Order", on_delete=models.SET_NULL, null=True, blank=True, related_name="stock_movements")
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    unit_cost  = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True,
                                     help_text="Coût unitaire au moment du mouvement (valorisation des pertes)")
    note       = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "stock_movements"
        ordering = ["-created_at"]
        verbose_name = "Mouvement de stock"

    def __str__(self):
        return f"{self.item.name} {self.delta:+d} ({self.get_reason_display()})"


# ══════════════════════════════════════════════════════════════════════════════
# Ingrédients, fournisseurs et recettes
# ══════════════════════════════════════════════════════════════════════════════
class Supplier(models.Model):
    """Fournisseur d'un restaurant (pour la liste de courses)."""
    restaurant   = models.ForeignKey("restaurants.Restaurant", on_delete=models.CASCADE, related_name="suppliers")
    name         = models.CharField(max_length=100)
    contact_name = models.CharField(max_length=100, blank=True)
    phone        = models.CharField(max_length=30, blank=True)
    email        = models.EmailField(blank=True)
    note         = models.CharField(max_length=200, blank=True, help_text="Jours de livraison, minimum de commande…")
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "suppliers"
        ordering = ["name"]
        unique_together = ["restaurant", "name"]
        verbose_name = "Fournisseur"

    def __str__(self):
        return self.name


class Ingredient(models.Model):
    """
    Matière première stockée par le restaurant (pain, steak, cheddar…).
    Le stock est exprimé dans l'unité de l'ingrédient (g, kg, ml, l, pièce).
    """
    UNIT_CHOICES = [
        ("g",  "g"), ("kg", "kg"), ("ml", "ml"), ("l", "l"), ("pc", "pièce"),
    ]

    id                  = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    restaurant          = models.ForeignKey("restaurants.Restaurant", on_delete=models.CASCADE, related_name="ingredients")
    name                = models.CharField(max_length=100)
    unit                = models.CharField(max_length=5, choices=UNIT_CHOICES, default="pc")
    stock_qty           = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    low_stock_threshold = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"),
                                              help_text="Alerte quand le stock atteint ce niveau")
    unit_cost           = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal("0"),
                                              help_text="Prix d'achat pour une unité (ex. 12.50 € / kg)")
    supplier            = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="ingredients")
    reorder_qty         = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True,
                                              help_text="Quantité habituellement commandée (liste de courses)")
    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ingredients"
        ordering = ["name"]
        unique_together = ["restaurant", "name"]
        verbose_name = "Ingrédient"

    def __str__(self):
        return f"{self.name} ({self.stock_qty} {self.unit})"

    @property
    def is_out_of_stock(self):
        return self.stock_qty <= 0

    @property
    def is_low_stock(self):
        return 0 < self.stock_qty <= self.low_stock_threshold

    @property
    def stock_value(self):
        return (self.stock_qty * self.unit_cost).quantize(Decimal("0.01"))

    @property
    def suggested_order(self):
        """Quantité à commander : la quantité habituelle, sinon de quoi remonter à 2× le seuil."""
        if self.reorder_qty:
            return self.reorder_qty
        target = self.low_stock_threshold * 2
        return max(Decimal("0"), target - self.stock_qty)


class RecipeLine(models.Model):
    """Une ligne de recette : le plat consomme `qty` unités de l'ingrédient par portion."""
    item       = models.ForeignKey(MenuItem, on_delete=models.CASCADE, related_name="recipe")
    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name="recipe_lines")
    qty        = models.DecimalField(max_digits=10, decimal_places=3)

    class Meta:
        db_table = "recipe_lines"
        unique_together = ["item", "ingredient"]
        ordering = ["id"]

    def __str__(self):
        return f"{self.item.name} ← {self.qty} {self.ingredient.unit} {self.ingredient.name}"


class IngredientMovement(models.Model):
    """Journal des mouvements de stock d'un ingrédient (même logique que StockMovement)."""
    SALE      = "vente"
    RESTOCK   = "reappro"
    WASTE     = "perte"
    INVENTORY = "inventaire"
    CANCEL    = "annulation"
    ADJUST    = "ajustement"

    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name="movements")
    delta      = models.DecimalField(max_digits=12, decimal_places=3)
    qty_after  = models.DecimalField(max_digits=12, decimal_places=3)
    reason     = models.CharField(max_length=20, choices=STOCK_REASON_CHOICES)
    order      = models.ForeignKey("orders.Order", on_delete=models.SET_NULL, null=True, blank=True, related_name="ingredient_movements")
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    unit_cost  = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    note       = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ingredient_movements"
        ordering = ["-created_at"]
        verbose_name = "Mouvement d'ingrédient"

    def __str__(self):
        return f"{self.ingredient.name} {self.delta:+} ({self.get_reason_display()})"
