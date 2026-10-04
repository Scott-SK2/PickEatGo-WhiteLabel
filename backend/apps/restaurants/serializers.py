"""restaurants/serializers.py"""
from rest_framework import serializers
from .models import Restaurant, BusinessHours, Report, Employee, RestaurantPhoto
from apps.accounts.serializers import UserSerializer
from apps.menus.serializers import CategorySerializer


class BusinessHoursSerializer(serializers.ModelSerializer):
    day_name = serializers.CharField(source="get_day_of_week_display", read_only=True)

    class Meta:
        model  = BusinessHours
        fields = ["id", "day_of_week", "day_name", "is_open", "open_time", "close_time"]


class RestaurantPhotoSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model  = RestaurantPhoto
        fields = ["id", "url", "caption", "order"]

    def get_url(self, obj):
        from apps.menus.serializers import image_url_of
        return image_url_of(obj.image, self.context.get("request"))


class RestaurantSerializer(serializers.ModelSerializer):
    owner_name   = serializers.CharField(source="owner.full_name", read_only=True)
    gallery      = RestaurantPhotoSerializer(many=True, read_only=True)
    owner_email  = serializers.CharField(source="owner.email", read_only=True)
    monthly_due  = serializers.ReadOnlyField()
    hours        = BusinessHoursSerializer(many=True, read_only=True)
    logo_url     = serializers.SerializerMethodField()
    banner_url   = serializers.SerializerMethodField()
    cuisine      = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    delivery_days = serializers.ListField(child=serializers.IntegerField(min_value=0, max_value=6), required=False)
    delivery_schedule_label = serializers.ReadOnlyField()
    is_open_now  = serializers.ReadOnlyField()      # interrupteur ET horaires du jour
    open_status  = serializers.ReadOnlyField()      # « Ouvert · ferme à 22:00 », « Fermé · ouvre à 11:30 »…

    class Meta:
        model  = Restaurant
        fields = [
            "id", "owner", "owner_name", "owner_email",
            "name", "slug", "description", "cuisine",
            "address", "city", "phone", "email",
            "logo", "logo_url", "banner", "banner_url", "banner_color", "emoji", "gallery",
            "status", "is_open", "is_open_now", "open_status", "slot_interval", "prep_time_avg", "max_orders_per_slot", "is_featured",
            "vat_number", "receipt_footer",
            "allow_on_site", "allow_pickup", "allow_delivery",
            "delivery_fee_mode", "delivery_fee", "delivery_free_above", "delivery_zones", "delivery_min_order",
            "delivery_days", "delivery_from", "delivery_until", "delivery_info", "delivery_schedule_label",
            "loyalty_enabled", "loyalty_target", "loyalty_reward_type", "loyalty_reward_value",
            # Contrat
            "contract_model", "commission_pct", "monthly_fee", "featured_fee",
            "admin_manages_menu", "contract_notes", "contract_paid",
            "invoicing_day", "monthly_due",
            # Stats
            "total_orders", "total_revenue", "avg_rating",
            "hours", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "slug", "owner", "owner_name", "owner_email", "delivery_schedule_label", "is_open_now", "open_status",
                            "total_orders", "total_revenue", "avg_rating",
                            "monthly_due", "created_at", "updated_at"]

    ADMIN_ONLY_FIELDS = ("status", "is_featured", "contract_model", "commission_pct", "monthly_fee", "featured_fee",
                         "admin_manages_menu", "contract_notes", "contract_paid", "invoicing_day")

    def get_fields(self):
        """Le contrat et le statut ne sont modifiables que par l'administration."""
        fields = super().get_fields()
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not (user and getattr(user, "is_admin_user", False)):
            for name in self.ADMIN_ONLY_FIELDS:
                if name in fields:
                    fields[name].read_only = True
        return fields

    # Visibles uniquement par l'administration et le propriétaire : contrat, facturation, coordonnées du propriétaire
    PRIVATE_FIELDS = ("owner_email", "contract_model", "commission_pct", "monthly_fee", "featured_fee",
                      "admin_manages_menu", "contract_notes", "contract_paid", "invoicing_day", "monthly_due", "total_revenue")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        allowed = user is not None and getattr(user, "is_authenticated", False) and (
            getattr(user, "is_admin_user", False) or instance.owner_id == user.id)
        if not allowed:
            for name in self.PRIVATE_FIELDS:
                data.pop(name, None)
        from apps.tenant.context import is_single_mode
        if is_single_mode():
            data["status"] = Restaurant.ACTIVE          # le restaurant lié est actif par construction
        return data

    def validate_delivery_days(self, value):
        return sorted(set(value or []))

    def validate_delivery_zones(self, value):
        """Normalise [{label, postcodes: [...], fee}] ; codes postaux sans espaces, frais ≥ 0."""
        from decimal import Decimal, InvalidOperation
        zones = []
        for z in value or []:
            if not isinstance(z, dict):
                raise serializers.ValidationError("Zone invalide.")
            raw = z.get("postcodes") or []
            if isinstance(raw, str):
                raw = raw.replace(";", ",").split(",")
            codes = [str(c).strip().replace(" ", "").upper() for c in raw if str(c).strip()]
            if not codes:
                raise serializers.ValidationError(f"La zone « {z.get('label') or '?'} » n'a aucun code postal.")
            try:
                fee = Decimal(str(z.get("fee", 0) or 0).replace(",", "."))
            except InvalidOperation:
                raise serializers.ValidationError("Frais de zone invalides.")
            if fee < 0:
                raise serializers.ValidationError("Les frais ne peuvent pas être négatifs.")
            zones.append({"label": str(z.get("label") or "")[:60], "postcodes": codes, "fee": str(fee.quantize(Decimal("0.01")))})
        return zones

    def validate(self, data):
        f = data.get("delivery_from", getattr(self.instance, "delivery_from", None))
        u = data.get("delivery_until", getattr(self.instance, "delivery_until", None))
        if f and u and f >= u:
            raise serializers.ValidationError({"delivery_until": "L'heure de fin doit être après l'heure de début."})
        flags = {k: data.get(k, getattr(self.instance, k, True)) for k in ("allow_on_site", "allow_pickup", "allow_delivery")}
        if self.instance is not None and not any(flags.values()):
            raise serializers.ValidationError({"allow_pickup": "Gardez au moins un mode de commande actif."})
        return data

    def _cloudinary_url(self, field_value):
        """URL Cloudinary si le fichier y a été envoyé (public_id sous le dossier configuré), sinon None."""
        try:
            from apps.menus.serializers import is_cloudinary_name
            from django.conf import settings as _s
            if is_cloudinary_name(str(field_value)):
                return f"https://res.cloudinary.com/{_s.CLOUDINARY_STORAGE['CLOUD_NAME']}/image/upload/{field_value}"
        except Exception:
            pass
        return None

    def get_logo_url(self, obj):
        if not obj.logo:
            return None
        url = self._cloudinary_url(obj.logo)
        if url:
            return url
        try:
            url = obj.logo.url
        except Exception:
            return None
        request = self.context.get("request")
        if request and url and not url.startswith(("http://", "https://")):
            return request.build_absolute_uri(url)
        return url

    def get_banner_url(self, obj):
        if not obj.banner:
            return None
        url = self._cloudinary_url(obj.banner)
        if url:
            return url
        try:
            url = obj.banner.url
        except Exception:
            return None
        request = self.context.get("request")
        if request and url and not url.startswith(("http://", "https://")):
            return request.build_absolute_uri(url)
        return url


class RestaurantDetailSerializer(RestaurantSerializer):
    categories = CategorySerializer(many=True, read_only=True)

    class Meta(RestaurantSerializer.Meta):
        fields = RestaurantSerializer.Meta.fields + ["categories"]


class ReportSerializer(serializers.ModelSerializer):
    reporter_name    = serializers.CharField(source="reporter.full_name", read_only=True)
    restaurant_name  = serializers.CharField(source="restaurant.name", read_only=True)

    class Meta:
        model  = Report
        fields = ["id", "restaurant", "restaurant_name", "reporter", "reporter_name",
                  "target_user", "reason", "status", "severity", "created_at"]
        read_only_fields = ["id", "reporter", "created_at"]

    def get_fields(self):
        """Statut et gravité d'un signalement : seule l'administration les fixe."""
        fields = super().get_fields()
        user = getattr(self.context.get("request"), "user", None)
        if not (user and getattr(user, "is_admin_user", False)):
            for name in ("status", "severity"):
                fields[name].read_only = True
        return fields

    def create(self, validated_data):
        validated_data["reporter"] = self.context["request"].user
        return super().create(validated_data)


class EmployeeSerializer(serializers.ModelSerializer):
    """PIN en écriture seule (haché en base). 4 à 6 chiffres, unique par restaurant."""
    pin          = serializers.CharField(write_only=True, required=False, allow_blank=False, min_length=4, max_length=6)
    role_display = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model  = Employee
        fields = ["id", "restaurant", "name", "role", "role_display", "pin", "is_active", "last_login_at", "created_at"]
        read_only_fields = ["id", "last_login_at", "created_at"]

    def validate_pin(self, value):
        if not value.isdigit():
            raise serializers.ValidationError("Le code PIN ne contient que des chiffres.")
        if len(set(value)) == 1 or value in ("1234", "0000", "1111", "123456"):
            raise serializers.ValidationError("Choisissez un code moins évident.")
        return value

    def validate(self, data):
        if self.instance is None and not data.get("pin"):
            raise serializers.ValidationError({"pin": "Un code PIN est requis."})
        pin = data.get("pin")
        if pin:
            restaurant = data.get("restaurant") or (self.instance.restaurant if self.instance else None)
            others = Employee.objects.filter(restaurant=restaurant, is_active=True)
            if self.instance:
                others = others.exclude(pk=self.instance.pk)
                data.pop("restaurant", None)
            if any(e.check_pin(pin) for e in others):
                raise serializers.ValidationError({"pin": "Ce code est déjà utilisé par un autre membre de l'équipe."})
        return data

    def create(self, validated_data):
        pin = validated_data.pop("pin")
        emp = Employee(**validated_data)
        emp.set_pin(pin)
        emp.save()
        return emp

    def update(self, instance, validated_data):
        pin = validated_data.pop("pin", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if pin:
            instance.set_pin(pin)
        instance.save()
        return instance
