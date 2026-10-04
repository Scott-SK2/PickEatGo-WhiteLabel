"""menus/serializers.py — avec gestion upload photo"""
from decimal import Decimal
from rest_framework import serializers
from .models import Category, MenuItem, MenuItemOption, MenuItemPhoto, StockMovement, Supplier, Ingredient, RecipeLine, IngredientMovement


def is_cloudinary_name(name):
    """Un fichier envoyé sur Cloudinary est stocké sous « <dossier>/… » ; un fichier local sous « menus/… »."""
    from django.conf import settings as _s
    _cs = getattr(_s, "CLOUDINARY_STORAGE", {})
    return bool(_cs.get("CLOUD_NAME")) and str(name).startswith(f"{_cs.get('PREFIX', 'pickeatgo')}/")


def image_url_of(field_value, request=None):
    """URL publique d'une image : Cloudinary si le fichier y est, sinon stockage local."""
    if not field_value:
        return None
    try:
        from django.conf import settings as _s
        if is_cloudinary_name(str(field_value)):
            return f"https://res.cloudinary.com/{_s.CLOUDINARY_STORAGE['CLOUD_NAME']}/image/upload/{field_value}"
    except Exception:
        pass
    try:
        url = field_value.url
    except Exception:
        return None
    if request and url and not url.startswith(("http://", "https://")):
        return request.build_absolute_uri(url)
    return url


class MenuItemPhotoSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model  = MenuItemPhoto
        fields = ["id", "url", "order"]

    def get_url(self, obj):
        return image_url_of(obj.image, self.context.get("request"))


class MenuItemOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MenuItemOption
        fields = ["id", "label", "extra_price", "is_default"]


class RecipeLineSerializer(serializers.ModelSerializer):
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    unit            = serializers.CharField(source="ingredient.unit", read_only=True)
    unit_cost       = serializers.DecimalField(source="ingredient.unit_cost", max_digits=10, decimal_places=4, read_only=True)
    ingredient_stock = serializers.DecimalField(source="ingredient.stock_qty", max_digits=12, decimal_places=3, read_only=True)

    class Meta:
        model  = RecipeLine
        fields = ["id", "ingredient", "ingredient_name", "unit", "qty", "unit_cost", "ingredient_stock"]


class MenuItemSerializer(serializers.ModelSerializer):
    options         = MenuItemOptionSerializer(many=True, read_only=True)
    image_url       = serializers.SerializerMethodField()
    category_name   = serializers.CharField(source="category.name", read_only=True)
    # Stock : lecture seule ici, les variations passent par /items/{id}/stock/ (traçabilité)
    stock_qty       = serializers.IntegerField(read_only=True)
    track_stock     = serializers.BooleanField(read_only=True)
    is_low_stock    = serializers.BooleanField(read_only=True)
    is_out_of_stock = serializers.BooleanField(read_only=True)
    auto_disabled   = serializers.BooleanField(read_only=True)
    # Recette : portions réalisables, ingrédient limitant, coût matière calculé
    has_recipe         = serializers.BooleanField(read_only=True)
    effective_stock    = serializers.IntegerField(read_only=True)
    portions_available = serializers.IntegerField(read_only=True)
    limited_by         = serializers.CharField(read_only=True)
    recipe             = serializers.SerializerMethodField()
    # Galerie : photo principale + photos supplémentaires (5 max au total)
    photos             = MenuItemPhotoSerializer(many=True, read_only=True)
    image_urls         = serializers.SerializerMethodField()

    def get_image_urls(self, obj):
        urls = [self.get_image_url(obj)] + [image_url_of(p.image, self.context.get("request")) for p in obj.photos.all()]
        return [u for u in urls if u]
    # Disponibilité programmée
    available_days     = serializers.ListField(child=serializers.IntegerField(min_value=0, max_value=6), required=False)
    is_scheduled       = serializers.BooleanField(read_only=True)
    is_available_now   = serializers.BooleanField(read_only=True)
    is_available_today = serializers.BooleanField(read_only=True)
    schedule_label     = serializers.CharField(read_only=True)

    def _is_manager(self, obj):
        """Propriétaire du restaurant ou admin : seuls eux voient recette, coûts et ingrédient limitant."""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not (user and user.is_authenticated):
            return False
        if user.is_admin_user:
            return True
        return obj.category.restaurant.owner_id == user.id

    def get_recipe(self, obj):
        if not self._is_manager(obj):
            return None
        return RecipeLineSerializer(obj.recipe.all(), many=True).data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self._is_manager(instance):
            # Le public ne voit ni le coût de revient ni le stock précis d'ingrédients
            for key in ("cost_price", "limited_by", "portions_available"):
                data.pop(key, None)
        return data

    def get_image_url(self, obj):
        return image_url_of(obj.image, self.context.get("request"))

    # ── Champ upload image ─────────────────────────────────────────────────────
    # Accepte multipart/form-data (fichier) OU une URL (string)
    image = serializers.ImageField(
        required=False,
        allow_null=True,
        use_url=True,
        max_length=None,
    )

    class Meta:
        model  = MenuItem
        fields = [
            "id", "category", "category_name", "name", "description", "price",
            "image", "image_url", "image_alt", "photos", "image_urls",
            "is_available", "is_featured", "allergens", "calories",
            "cost_price", "stock_qty", "low_stock_threshold", "track_stock",
            "is_low_stock", "is_out_of_stock", "auto_disabled",
            "has_recipe", "effective_stock", "portions_available", "limited_by", "recipe",
            "available_days", "available_from", "available_until", "available_on",
            "is_scheduled", "is_available_now", "is_available_today", "schedule_label",
            "order", "options", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_cost_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Le prix de revient ne peut pas être négatif.")
        return value

    def validate_available_days(self, value):
        return sorted(set(value or []))

    def validate(self, data):
        # Avec une recette, le prix de revient est calculé : on ignore une saisie manuelle
        if self.instance is not None and "cost_price" in data and self.instance.has_recipe:
            data.pop("cost_price")
        f = data.get("available_from", getattr(self.instance, "available_from", None))
        u = data.get("available_until", getattr(self.instance, "available_until", None))
        if f and u and f >= u:
            raise serializers.ValidationError({"available_until": "L'heure de fin doit être après l'heure de début."})
        return data

    def validate_image(self, value):
        """Vérifie que l'image fait max 5 MB"""
        if value and hasattr(value, "size"):
            max_size = 5 * 1024 * 1024  # 5 MB
            if value.size > max_size:
                raise serializers.ValidationError("L'image ne doit pas dépasser 5 MB.")
        return value

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Le prix doit être supérieur à 0.")
        return value


class MenuItemWriteSerializer(MenuItemSerializer):
    """Serializer d'écriture — accepte options en création"""
    options = MenuItemOptionSerializer(many=True, required=False)

    def create(self, validated_data):
        options_data = validated_data.pop("options", [])
        item = MenuItem.objects.create(**validated_data)
        for opt in options_data:
            MenuItemOption.objects.create(item=item, **opt)
        return item

    def update(self, instance, validated_data):
        options_data = validated_data.pop("options", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if options_data is not None:
            instance.options.all().delete()
            for opt in options_data:
                MenuItemOption.objects.create(item=instance, **opt)
        return instance


class StockMovementSerializer(serializers.ModelSerializer):
    item_name      = serializers.CharField(source="item.name", read_only=True)
    reason_display = serializers.CharField(source="get_reason_display", read_only=True)
    order_number   = serializers.CharField(source="order.number", read_only=True, default=None)
    user_name      = serializers.SerializerMethodField()
    value          = serializers.SerializerMethodField()

    class Meta:
        model  = StockMovement
        fields = ["id", "item", "item_name", "delta", "qty_after", "reason", "reason_display",
                  "order", "order_number", "user", "user_name", "unit_cost", "value", "note", "created_at"]

    def get_user_name(self, obj):
        return obj.user.full_name if obj.user else None

    def get_value(self, obj):
        """Valorisation du mouvement (|delta| × coût unitaire) — utile pour les pertes."""
        if obj.unit_cost is None:
            return None
        return str(abs(obj.delta) * obj.unit_cost)


class CategorySerializer(serializers.ModelSerializer):
    items = MenuItemSerializer(many=True, read_only=True)
    item_count = serializers.SerializerMethodField()

    class Meta:
        model  = Category
        fields = ["id", "restaurant", "name", "description", "order", "is_active", "items", "item_count"]
        read_only_fields = ["id"]

    def get_item_count(self, obj):
        return obj.items.filter(is_available=True).count()


# ══════════════════════════════════════════════════════════════════════════════
# Fournisseurs, ingrédients, recettes
# ══════════════════════════════════════════════════════════════════════════════
class SupplierSerializer(serializers.ModelSerializer):
    ingredient_count = serializers.SerializerMethodField()

    class Meta:
        model  = Supplier
        fields = ["id", "restaurant", "name", "contact_name", "phone", "email", "note", "is_active", "ingredient_count", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_ingredient_count(self, obj):
        return obj.ingredients.count()


class IngredientSerializer(serializers.ModelSerializer):
    supplier_name   = serializers.CharField(source="supplier.name", read_only=True, default=None)
    unit_display    = serializers.CharField(source="get_unit_display", read_only=True)
    is_out_of_stock = serializers.BooleanField(read_only=True)
    is_low_stock    = serializers.BooleanField(read_only=True)
    stock_value     = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    suggested_order = serializers.DecimalField(max_digits=12, decimal_places=3, read_only=True)
    used_by         = serializers.SerializerMethodField()
    # Le stock se modifie via /ingredients/{id}/stock/ (traçabilité) — sauf à la création (stock initial)
    stock_qty       = serializers.DecimalField(max_digits=12, decimal_places=3, required=False, min_value=Decimal("0"))

    class Meta:
        model  = Ingredient
        fields = ["id", "restaurant", "name", "unit", "unit_display", "stock_qty", "low_stock_threshold",
                  "unit_cost", "supplier", "supplier_name", "reorder_qty", "is_active",
                  "is_out_of_stock", "is_low_stock", "stock_value", "suggested_order", "used_by",
                  "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_used_by(self, obj):
        return [{"id": str(l.item_id), "name": l.item.name, "qty": str(l.qty)} for l in obj.recipe_lines.select_related("item")]

    def validate_unit_cost(self, value):
        if value < 0:
            raise serializers.ValidationError("Le prix d'achat ne peut pas être négatif.")
        return value

    def validate_low_stock_threshold(self, value):
        if value < 0:
            raise serializers.ValidationError("Le seuil ne peut pas être négatif.")
        return value

    def validate(self, data):
        supplier = data.get("supplier")
        restaurant = data.get("restaurant") or (self.instance.restaurant if self.instance else None)
        if supplier and restaurant and supplier.restaurant_id != restaurant.id:
            raise serializers.ValidationError({"supplier": "Ce fournisseur appartient à un autre restaurant."})
        if self.instance is not None:
            data.pop("stock_qty", None)     # modification du stock uniquement via un mouvement tracé
            data.pop("restaurant", None)
        return data


class IngredientMovementSerializer(serializers.ModelSerializer):
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    unit            = serializers.CharField(source="ingredient.unit", read_only=True)
    reason_display  = serializers.CharField(source="get_reason_display", read_only=True)
    order_number    = serializers.CharField(source="order.number", read_only=True, default=None)
    user_name       = serializers.SerializerMethodField()
    value           = serializers.SerializerMethodField()

    class Meta:
        model  = IngredientMovement
        fields = ["id", "ingredient", "ingredient_name", "unit", "delta", "qty_after", "reason", "reason_display",
                  "order", "order_number", "user", "user_name", "unit_cost", "value", "note", "created_at"]

    def get_user_name(self, obj):
        return obj.user.full_name if obj.user else None

    def get_value(self, obj):
        if obj.unit_cost is None:
            return None
        return str((abs(obj.delta) * obj.unit_cost).quantize(Decimal("0.01")))


class RecipeLineWriteSerializer(serializers.Serializer):
    ingredient = serializers.UUIDField()
    qty        = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))


class RecipeWriteSerializer(serializers.Serializer):
    """PUT /items/{id}/recipe/  Body : {"lines": [{"ingredient": "<uuid>", "qty": 0.15}, …]}"""
    lines = RecipeLineWriteSerializer(many=True)

    def validate_lines(self, lines):
        seen = set()
        for l in lines:
            if l["ingredient"] in seen:
                raise serializers.ValidationError("Un ingrédient ne peut apparaître qu'une fois dans la recette.")
            seen.add(l["ingredient"])
        return lines
