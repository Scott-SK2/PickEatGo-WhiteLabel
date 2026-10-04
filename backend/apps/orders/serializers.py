"""orders/serializers.py"""
from rest_framework import serializers
from django.db import transaction
from django.utils import timezone
from .models import Order, OrderItem, DailyClosure, PromoCode
from .promotions import apply_discounts
from apps.menus.models import MenuItem, MenuItemOption
from apps.menus.stock import consume_for_order, check_availability


class OrderItemSerializer(serializers.ModelSerializer):
    subtotal = serializers.ReadOnlyField()

    class Meta:
        model  = OrderItem
        fields = ["id","menu_item","name","price","qty","options","subtotal"]
        read_only_fields = ["id","name","price","subtotal"]


class OrderItemCreateSerializer(serializers.Serializer):
    menu_item_id = serializers.UUIDField()
    qty          = serializers.IntegerField(min_value=1, max_value=50)
    options      = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)


class OrderSerializer(serializers.ModelSerializer):
    items                  = OrderItemSerializer(many=True, read_only=True)
    client_name            = serializers.SerializerMethodField()
    client_phone           = serializers.SerializerMethodField()
    restaurant_name        = serializers.CharField(source="restaurant.name", read_only=True)
    subtotal               = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    status_display         = serializers.CharField(source="get_status_display", read_only=True)
    order_type_display     = serializers.CharField(source="get_order_type_display", read_only=True)
    payment_method_display = serializers.CharField(source="get_payment_method_display", read_only=True)
    created_by_name        = serializers.SerializerMethodField()
    employee_name          = serializers.CharField(source="employee.name", read_only=True, default=None)

    class Meta:
        model  = Order
        fields = [
            "id","number","client","client_name","client_phone","restaurant","restaurant_name",
            "status","status_display","order_type","order_type_display",
            "payment_method","payment_method_display","created_by","created_by_name","employee","employee_name",
            "pickup_slot","pickup_date","note",
            "total_price","subtotal","discount_amount","discount_label","loyalty_reward","delivery_address","delivery_postcode","delivery_fee",
            "client_rating","client_comment","owner_reply","owner_reply_at","items","created_at","updated_at",
        ]
        read_only_fields = ["id","number","total_price","subtotal","discount_amount","discount_label","loyalty_reward","delivery_fee",
                            "client_rating","client_comment","owner_reply","owner_reply_at","created_at","updated_at"]

    def get_client_name(self, obj):
        if obj.order_type == Order.COUNTER:
            return "Vente comptoir"
        return obj.client.full_name if obj.client else "Client supprimé"

    def get_created_by_name(self, obj):
        return obj.created_by.full_name if obj.created_by else None

    def get_client_phone(self, obj):
        """
        Retourne le téléphone du client si :
        - Le client a phone_visible=True (choix du client)
        - OU si c'est l'admin qui consulte (accès total)
        Le restaurateur voit le numéro uniquement si le client l'a autorisé.
        """
        if not obj.client:
            return None
        request = self.context.get("request")
        # Admin voit toujours le numéro
        if request and hasattr(request.user, "is_admin_user") and request.user.is_admin_user:
            return obj.client.phone or None
        # Restaurateur : uniquement si le client a activé la visibilité
        if obj.client.phone_visible:
            return obj.client.phone or None
        return None


def build_order_items(order, items_data, *, require_available=True):
    """
    Crée les lignes d'une commande à partir des données validées, vérifie le stock
    et la disponibilité programmée à l'heure de retrait, et retourne le total.
    Utilisé par la commande en ligne (require_available) et la vente comptoir.
    """
    total_price = 0
    pickup_dt = None
    if require_available and order.pickup_date and order.pickup_slot:
        from datetime import datetime
        pickup_dt = datetime.combine(order.pickup_date, order.pickup_slot)
    for item_data in items_data:
        lookup = dict(id=item_data["menu_item_id"], category__restaurant=order.restaurant)
        if require_available:
            lookup["is_available"] = True
        try:
            menu_item = MenuItem.objects.prefetch_related("recipe__ingredient").get(**lookup)
        except MenuItem.DoesNotExist:
            raise serializers.ValidationError(
                f"Plat introuvable ou indisponible : {item_data['menu_item_id']}"
            )
        if pickup_dt is not None and not menu_item.is_available_at(pickup_dt):
            raise serializers.ValidationError(
                f"« {menu_item.name} » n'est pas proposé à l'heure de retrait choisie ({menu_item.schedule_label})."
            )
        stock_error = check_availability(menu_item, item_data["qty"])
        if stock_error:
            raise serializers.ValidationError(stock_error)
        option_ids    = item_data.get("options", [])
        opts_extra    = 0
        opts_snapshot = []
        if option_ids:
            db_opts = MenuItemOption.objects.filter(id__in=option_ids, item=menu_item)
            for opt in db_opts:
                opts_extra += opt.extra_price
                opts_snapshot.append({"label": opt.label, "extra_price": str(opt.extra_price)})
        unit_price = menu_item.price + opts_extra
        subtotal   = unit_price * item_data["qty"]
        total_price += subtotal
        OrderItem.objects.create(
            order=order, menu_item=menu_item,
            name=menu_item.name, price=unit_price,
            qty=item_data["qty"], options=opts_snapshot,
        )
    return total_price


class OrderCreateSerializer(serializers.ModelSerializer):
    """Commande passée par un client sur le site."""
    items      = OrderItemCreateSerializer(many=True, min_length=1)
    promo_code = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model  = Order
        fields = ["restaurant","order_type","pickup_slot","pickup_date","note","items","promo_code","delivery_address","delivery_postcode"]

    def validate_order_type(self, value):
        if value == Order.COUNTER:
            raise serializers.ValidationError("Type réservé aux ventes au comptoir.")
        return value

    def validate(self, data):
        restaurant = data["restaurant"]
        from apps.tenant.context import is_tenant_restaurant
        if not is_tenant_restaurant(restaurant):
            raise serializers.ValidationError("Ce restaurant n'est pas disponible.")
        if restaurant.status != "active":
            raise serializers.ValidationError("Ce restaurant n'est pas disponible.")
        if not restaurant.is_open_now:
            raise serializers.ValidationError(f"Ce restaurant est actuellement fermé ({restaurant.open_status.lower()}).")
        # Le retrait ne peut pas être dans le passé (tolérance de 30 min pour une commande en cours de saisie)
        if data.get("pickup_date") and data.get("pickup_slot"):
            from datetime import datetime, timedelta
            when = timezone.make_aware(datetime.combine(data["pickup_date"], data["pickup_slot"]))
            if when < timezone.localtime() - timedelta(minutes=30):
                raise serializers.ValidationError({"pickup_slot": "Cet horaire est déjà passé. Choisissez un horaire à venir."})
        order_type = data.get("order_type", Order.PICKUP)
        if not restaurant.allows(order_type):
            labels = dict(Order.TYPE_CHOICES)
            raise serializers.ValidationError({"order_type": f"{labels.get(order_type, order_type)} n'est pas proposé par ce restaurant."})
        if order_type == Order.DELIVERY:
            if not (data.get("delivery_address") or "").strip():
                raise serializers.ValidationError({"delivery_address": "Indiquez l'adresse de livraison."})
            if data.get("pickup_date") and data.get("pickup_slot"):
                from datetime import datetime
                if not restaurant.delivery_available_at(datetime.combine(data["pickup_date"], data["pickup_slot"])):
                    raise serializers.ValidationError({"pickup_slot": f"La livraison n'est possible que : {restaurant.delivery_schedule_label}."})
        else:
            data["delivery_address"] = ""
            data["delivery_postcode"] = ""
        max_per_slot = restaurant.max_orders_per_slot
        if max_per_slot and data.get("pickup_date") and data.get("pickup_slot"):
            count = Order.objects.filter(
                restaurant=restaurant,
                pickup_date=data["pickup_date"],
                pickup_slot=data["pickup_slot"],
            ).exclude(status=Order.CANCELLED).count()
            if count >= max_per_slot:
                raise serializers.ValidationError(
                    "Ce créneau est complet. Veuillez choisir un autre horaire."
                )
        return data

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items")
        promo      = validated_data.pop("promo_code", "")
        client     = self.context["request"].user
        # Verrou sur le restaurant : la capacité du créneau est recomptée à l'abri des commandes simultanées
        from apps.restaurants.models import Restaurant
        restaurant = Restaurant.objects.select_for_update().get(pk=validated_data["restaurant"].pk)
        if restaurant.max_orders_per_slot and validated_data.get("pickup_date") and validated_data.get("pickup_slot"):
            taken = Order.objects.filter(restaurant=restaurant, pickup_date=validated_data["pickup_date"],
                                         pickup_slot=validated_data["pickup_slot"]).exclude(status=Order.CANCELLED).count()
            if taken >= restaurant.max_orders_per_slot:
                raise serializers.ValidationError("Ce créneau est complet. Veuillez choisir un autre horaire.")
        order = Order.objects.create(client=client, total_price=0, **validated_data)
        order.total_price = build_order_items(order, items_data, require_available=True)
        order.save(update_fields=["total_price"])
        try:
            apply_discounts(order, promo_code=promo or None)     # code promo ou récompense fidélité
        except ValueError as e:
            raise serializers.ValidationError({"promo_code": str(e)})
        if order.order_type == Order.DELIVERY:
            r = order.restaurant
            if order.subtotal < r.delivery_min_order:
                raise serializers.ValidationError({"delivery_address": f"Livraison à partir de {r.delivery_min_order:.2f} € de commande."})
            fee, err = r.delivery_quote(order.delivery_postcode, order.subtotal)
            if err:
                raise serializers.ValidationError({"delivery_postcode": err})
            order.delivery_fee = fee
            order.total_price = order.total_price + fee
            order.save(update_fields=["delivery_fee", "total_price"])
        try:
            consume_for_order(order, user=client)   # réserve le stock dès la commande
        except ValueError as e:
            raise serializers.ValidationError({"items": str(e)})
        return order


class CounterSaleSerializer(serializers.Serializer):
    """
    Vente encaissée au comptoir par le restaurateur (client de passage).
    Crée une commande de type « comptoir » directement au statut Récupérée.
    """
    restaurant     = serializers.UUIDField()
    items          = OrderItemCreateSerializer(many=True, min_length=1)
    payment_method = serializers.ChoiceField(choices=[Order.PAY_CASH, Order.PAY_CARD])
    note           = serializers.CharField(required=False, allow_blank=True, default="")
    employee       = serializers.UUIDField(required=False, allow_null=True)
    promo_code     = serializers.CharField(required=False, allow_blank=True)

    def validate_employee(self, value):
        if value is None:
            return None
        emp = self.context["restaurant"].employees.filter(pk=value, is_active=True).first()
        if emp is None:
            raise serializers.ValidationError("Employé inconnu pour ce restaurant.")
        return emp

    @transaction.atomic
    def create(self, validated_data):
        user       = self.context["request"].user
        restaurant = self.context["restaurant"]
        now = timezone.localtime()
        order = Order.objects.create(
            client=None, restaurant=restaurant, created_by=user, employee=validated_data.get("employee"),
            order_type=Order.COUNTER, status=Order.PICKED_UP,
            payment_method=validated_data["payment_method"],
            pickup_date=now.date(), pickup_slot=now.time().replace(microsecond=0),
            note=validated_data.get("note", ""), total_price=0,
        )
        order.total_price = build_order_items(order, validated_data["items"], require_available=False)
        order.save(update_fields=["total_price"])
        try:
            apply_discounts(order, promo_code=validated_data.get("promo_code") or None, use_loyalty=False)
        except ValueError as e:
            raise serializers.ValidationError({"promo_code": str(e)})
        consume_for_order(order, user=user)
        return order


class DailyClosureSerializer(serializers.ModelSerializer):
    closed_by_name = serializers.SerializerMethodField()

    class Meta:
        model  = DailyClosure
        fields = ["id","restaurant","date","closed_by","closed_by_name","note",
                  "orders_count","items_count","total","total_cash","total_card","total_online","total_unspecified",
                  "online_orders","counter_orders","cancelled_orders","waste_count","waste_value",
                  "items_summary","created_at"]
        read_only_fields = [f for f in fields if f not in ("note",)]

    def get_closed_by_name(self, obj):
        return obj.closed_by.full_name if obj.closed_by else None


class PromoCodeSerializer(serializers.ModelSerializer):
    label = serializers.ReadOnlyField()

    class Meta:
        model  = PromoCode
        fields = ["id","restaurant","code","kind","value","label","min_order","starts_at","ends_at","max_uses","uses","is_active","created_at"]
        read_only_fields = ["id","uses","created_at"]

    def validate_code(self, value):
        value = value.strip().upper()
        if not value.replace("-", "").replace("_", "").isalnum() or len(value) < 3:
            raise serializers.ValidationError("Le code doit contenir au moins 3 lettres ou chiffres (tirets autorisés).")
        return value

    def validate(self, data):
        kind = data.get("kind", getattr(self.instance, "kind", PromoCode.PERCENT))
        value = data.get("value", getattr(self.instance, "value", None))
        if value is not None and (value <= 0 or (kind == PromoCode.PERCENT and value > 100)):
            raise serializers.ValidationError({"value": "Valeur invalide."})
        s, e = data.get("starts_at", getattr(self.instance, "starts_at", None)), data.get("ends_at", getattr(self.instance, "ends_at", None))
        if s and e and s > e:
            raise serializers.ValidationError({"ends_at": "La fin doit être après le début."})
        if self.instance is not None:
            data.pop("restaurant", None)
        return data
