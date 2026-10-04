"""orders/views.py"""
import json
from datetime import date
from django.core.exceptions import ValidationError
from django.http import HttpResponse
from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, permissions, status, mixins
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from .models import Order, DailyClosure
from .serializers import OrderSerializer, OrderCreateSerializer, CounterSaleSerializer, DailyClosureSerializer
from . import reports
from apps.menus.stock import restore_for_order
from apps.restaurants.access import get_owned_restaurant
from apps.notifications.push import notify_order_status, notify_new_order
from apps.notifications import emails
from .promotions import loyalty_status, validate_promo, release_promo
from .models import PromoCode
from .serializers import PromoCodeSerializer
from apps.menus.views import LargePagination
from apps.tenant.context import scope_by_restaurant, scope_restaurants


def order_to_dict(order):
    """Convertit une commande en dict JSON-sérialisable (sans UUID natifs)."""
    renderer = JSONRenderer()
    data = OrderSerializer(order).data
    # Passe par JSON pour convertir UUID, Decimal, datetime en strings
    return json.loads(renderer.render(data))


class OrderViewSet(viewsets.ModelViewSet):
    """Une commande se crée puis évolue uniquement par ses actions (advance, cancel, rate…) : jamais par PUT/PATCH/DELETE directs."""
    pagination_class = LargePagination
    filter_backends  = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["status", "order_type", "restaurant", "pickup_date", "client"]
    ordering_fields  = ["created_at", "pickup_slot", "total_price"]
    ordering         = ["-created_at"]

    def get_permissions(self):
        if self.action == "delivery_quote":       # devis public (panier avant connexion)
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_serializer_class(self):
        if self.action == "create":
            return OrderCreateSerializer
        return OrderSerializer

    def update(self, request, *args, **kwargs):
        return Response({"detail": "Une commande ne se modifie pas directement."}, status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        return Response({"detail": "Une commande ne se supprime pas ; annulez-la."}, status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def get_queryset(self):
        user = self.request.user
        qs   = scope_by_restaurant(Order.objects.select_related("client", "restaurant").prefetch_related("items__menu_item"))
        if user.is_client:
            return qs.filter(client=user)
        if user.is_restaurateur:
            return qs.filter(restaurant__owner=user)
        if user.is_admin_user:
            return qs
        return qs.none()

    def perform_create(self, serializer):
        order = serializer.save()
        try:
            self._notify_restaurant(order, "new_order")
        except Exception as e:
            print(f"[WS] Erreur notification new_order: {e}")
        try:
            notify_new_order(order)          # push vers les appareils du restaurateur
        except Exception as e:
            print(f"[Push] Erreur new_order: {e}")
        try:
            emails.order_confirmation(order)  # récapitulatif e-mail au client
        except Exception as e:
            print(f"[Mail] Erreur confirmation: {e}")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        order = serializer.instance
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch"], url_path="advance")
    @transaction.atomic
    def advance(self, request, pk=None):
        # get_object() est limité par get_queryset() — on bypass pour les actions.
        # Verrou sur la commande : deux clics simultanés ne font avancer qu'une étape.
        from .models import Order as OrderModel
        try:
            order = OrderModel.objects.select_for_update(of=("self",)).select_related("restaurant__owner", "client").prefetch_related("items__menu_item").get(pk=pk)
        except OrderModel.DoesNotExist:
            return Response({"detail": "Commande introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if not (request.user.is_admin_user or
                (order.restaurant and order.restaurant.owner_id == request.user.id)):
            return Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)
        if not order.can_advance:
            return Response({"detail": "Cette commande ne peut plus avancer."}, status=status.HTTP_400_BAD_REQUEST)
        # Mode de paiement renseigné à la remise de la commande (espèces / carte / en ligne)
        payment = request.data.get("payment_method")
        if payment in dict(Order.PAYMENT_CHOICES):
            order.payment_method = payment
            order.save(update_fields=["payment_method"])
        # Employé (PIN) qui traite l'étape — conservé sur la commande (dernier intervenant)
        emp_id = request.data.get("employee")
        if emp_id:
            emp = order.restaurant.employees.filter(pk=emp_id, is_active=True).first() if order.restaurant else None
            if emp is not None:
                order.employee = emp
                order.save(update_fields=["employee"])
        new_status = order.advance_status()
        try:
            self._notify_all(order, "status_update")
        except Exception as e:
            print(f"[WS] Erreur notification status_update: {e}")
        return Response({"status": new_status, "status_display": order.get_status_display()})

    @action(detail=True, methods=["patch"], url_path="cancel")
    @transaction.atomic
    def cancel(self, request, pk=None):
        from .models import Order as OrderModel
        try:
            order = OrderModel.objects.select_for_update(of=("self",)).select_related("restaurant__owner", "client").prefetch_related("items__menu_item").get(pk=pk)
        except OrderModel.DoesNotExist:
            return Response({"detail": "Commande introuvable."}, status=status.HTTP_404_NOT_FOUND)
        is_owner = order.restaurant and order.restaurant.owner_id == request.user.id
        is_client = order.client_id == request.user.id
        if not (request.user.is_admin_user or is_owner or is_client):
            return Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)
        # Le client ne peut annuler que si la commande est encore "nouvelle"
        if is_client and not request.user.is_admin_user and not is_owner:
            if order.status != Order.NEW:
                return Response({"detail": "Vous ne pouvez plus annuler cette commande."}, status=status.HTTP_400_BAD_REQUEST)
        if order.status in [Order.READY, Order.DELIVERING, Order.PICKED_UP, Order.CANCELLED]:
            return Response({"detail": "Impossible d'annuler cette commande."}, status=status.HTTP_400_BAD_REQUEST)
        order.status = Order.CANCELLED
        order.save(update_fields=["status", "updated_at"])
        restore_for_order(order, user=request.user)   # remet en stock ce qui avait été réservé
        release_promo(order)                           # rend l'utilisation du code promo
        try:
            self._notify_all(order, "status_update")
        except Exception as e:
            print(f"[WS] Erreur notification cancel: {e}")
        return Response({"status": order.status})

    # ── Gestion : vente comptoir, ventes, statistiques ────────────────────────
    def _restaurant_or_403(self, request, restaurant_id):
        restaurant = get_owned_restaurant(request.user, restaurant_id)
        if restaurant is None:
            return None, Response({"detail": "Restaurant introuvable ou accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        return restaurant, None

    @action(detail=False, methods=["post"], url_path="counter")
    def counter_sale(self, request):
        """
        POST /api/v1/orders/counter/ — Encaisse une vente au comptoir.
        Body : {"restaurant": id, "items": [{"menu_item_id", "qty", "options"}], "payment_method": "especes"|"carte", "note"}
        """
        restaurant, err = self._restaurant_or_403(request, request.data.get("restaurant"))
        if err:
            return err
        serializer = CounterSaleSerializer(data=request.data, context={"request": request, "restaurant": restaurant})
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        return Response(OrderSerializer(order, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="sales")
    def sales(self, request):
        """GET /api/v1/orders/sales/?restaurant=&from=&to=&group=day|week|month — journal et synthèse des ventes."""
        restaurant, err = self._restaurant_or_403(request, request.query_params.get("restaurant"))
        if err:
            return err
        d_from, d_to = reports.parse_range(request.query_params)
        group = request.query_params.get("group", "day")
        if group not in ("day", "week", "month"):
            group = "day"
        return Response(reports.sales_summary(restaurant, d_from, d_to, group))

    @action(detail=False, methods=["get"], url_path="sales/export")
    def sales_export(self, request):
        """GET /api/v1/orders/sales/export/?restaurant=&from=&to=&type=csv|xlsx — export tableur."""
        restaurant, err = self._restaurant_or_403(request, request.query_params.get("restaurant"))
        if err:
            return err
        d_from, d_to = reports.parse_range(request.query_params)
        rows = reports.export_rows(restaurant, d_from, d_to)
        base = f"ventes-{restaurant.slug or 'restaurant'}-{d_from}-{d_to}"
        if request.query_params.get("type") == "xlsx":
            content = reports.export_xlsx(rows, title=f"Ventes {d_from} {d_to}")
            resp = HttpResponse(content, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            resp["Content-Disposition"] = f'attachment; filename="{base}.xlsx"'
        else:
            resp = HttpResponse(reports.export_csv(rows), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{base}.csv"'
        return resp

    @action(detail=False, methods=["get"], url_path="customers")
    def customers(self, request):
        """
        GET /api/v1/orders/customers/?restaurant=&search=&ordering=-total_spent|-orders|-last_order|name[&type=csv]
        Clientèle du restaurant (clients ayant commandé), coordonnées seulement si le client les partage.
        """
        restaurant, err = self._restaurant_or_403(request, request.query_params.get("restaurant"))
        if err:
            return err
        data = reports.customers_summary(
            restaurant,
            search=request.query_params.get("search", ""),
            ordering=request.query_params.get("ordering", "-total_spent"),
            show_contact_for_admin=request.user.is_admin_user,
        )
        if request.query_params.get("type") == "csv":
            resp = HttpResponse(reports.customers_export_csv(data["customers"]), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="clients-{restaurant.slug or "restaurant"}.csv"'
            return resp
        return Response(data)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """GET /api/v1/orders/stats/?restaurant=&days=7 — activité quotidienne réelle pour les graphiques."""
        restaurant, err = self._restaurant_or_403(request, request.query_params.get("restaurant"))
        if err:
            return err
        try:
            days = max(1, min(int(request.query_params.get("days", 7)), 90))
        except ValueError:
            days = 7
        return Response({"days": reports.daily_stats(restaurant, days)})

    @action(detail=True, methods=["post"], url_path="rate")
    def rate(self, request, pk=None):
        """POST /api/v1/orders/{id}/rate/ — Client soumet une note 1–5"""
        from .models import Order as OrderModel
        try:
            order = OrderModel.objects.select_related("restaurant").get(pk=pk, client=request.user)
        except OrderModel.DoesNotExist:
            return Response({"detail": "Commande introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if order.status != Order.PICKED_UP:
            return Response({"detail": "La commande doit être récupérée pour la noter."}, status=status.HTTP_400_BAD_REQUEST)
        if order.client_rating is not None:
            return Response({"detail": "Vous avez déjà noté cette commande."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            rating = int(request.data.get("rating", 0))
        except (TypeError, ValueError):
            rating = 0
        if not (1 <= rating <= 5):
            return Response({"detail": "Note invalide (1 à 5)."}, status=status.HTTP_400_BAD_REQUEST)
        order.client_rating  = rating
        order.client_comment = str(request.data.get("comment", ""))[:1000]
        order.rated_at       = timezone.now()
        order.save(update_fields=["client_rating", "client_comment", "rated_at", "updated_at"])
        # Recalcule avg_rating du restaurant
        if order.restaurant:
            from django.db.models import Avg
            avg = OrderModel.objects.filter(
                restaurant=order.restaurant, client_rating__isnull=False
            ).aggregate(Avg("client_rating"))["client_rating__avg"]
            if avg is not None:
                order.restaurant.avg_rating = round(avg, 2)
                order.restaurant.save(update_fields=["avg_rating"])
        return Response({"detail": "Note enregistrée.", "rating": order.client_rating})

    # ── Fidélité et codes promo ───────────────────────────────────────────────
    @action(detail=False, methods=["get"], url_path="loyalty")
    def loyalty(self, request):
        """GET /api/v1/orders/loyalty/?restaurant=<id> — carte de fidélité du client connecté."""
        from apps.restaurants.models import Restaurant
        try:
            restaurant = scope_restaurants(Restaurant.objects.all()).get(pk=request.query_params.get("restaurant"))
        except Exception:
            return Response({"detail": "Restaurant introuvable."}, status=status.HTTP_404_NOT_FOUND)
        return Response(loyalty_status(restaurant, request.user))

    @action(detail=False, methods=["post"], url_path="delivery/quote", permission_classes=[permissions.AllowAny])
    def delivery_quote(self, request):
        """POST /api/v1/orders/delivery/quote/ {"restaurant", "postcode", "subtotal"} → frais de livraison ou motif de refus."""
        from apps.restaurants.models import Restaurant
        from decimal import Decimal, InvalidOperation
        try:
            restaurant = scope_restaurants(Restaurant.objects.all()).get(pk=request.data.get("restaurant"))
            subtotal = Decimal(str(request.data.get("subtotal", "0")))
        except (Restaurant.DoesNotExist, ValueError, InvalidOperation, TypeError, ValidationError):
            return Response({"detail": "Requête invalide."}, status=status.HTTP_400_BAD_REQUEST)
        if not restaurant.allow_delivery:
            return Response({"detail": "Ce restaurant ne livre pas."}, status=status.HTTP_400_BAD_REQUEST)
        fee, err = restaurant.delivery_quote(request.data.get("postcode"), subtotal)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        below_min = subtotal < restaurant.delivery_min_order
        return Response({"fee": str(fee), "free": fee == 0, "min_order": str(restaurant.delivery_min_order), "below_min": below_min,
                         "free_above": str(restaurant.delivery_free_above) if restaurant.delivery_free_above is not None else None})

    @action(detail=False, methods=["post"], url_path="promo/check")
    def promo_check(self, request):
        """POST /api/v1/orders/promo/check/ {"restaurant", "code", "subtotal"} — vérifie un code et calcule la remise."""
        from apps.restaurants.models import Restaurant
        from decimal import Decimal, InvalidOperation
        try:
            restaurant = scope_restaurants(Restaurant.objects.all()).get(pk=request.data.get("restaurant"))
            subtotal = Decimal(str(request.data.get("subtotal", "0")))
        except (Restaurant.DoesNotExist, ValueError, InvalidOperation, TypeError, ValidationError):
            return Response({"detail": "Requête invalide."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            promo, discount = validate_promo(restaurant, request.data.get("code"), subtotal)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"code": promo.code, "label": promo.label, "discount": str(discount), "total": str(subtotal - discount)})

    @action(detail=True, methods=["post"], url_path="reply")
    def reply(self, request, pk=None):
        """POST /api/v1/orders/{id}/reply/ {"reply": "..."} — réponse publique du restaurateur à un avis (vide = retirer)."""
        from .models import Order as OrderModel
        try:
            order = OrderModel.objects.select_related("restaurant__owner").get(pk=pk)
        except OrderModel.DoesNotExist:
            return Response({"detail": "Commande introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if not (request.user.is_admin_user or (order.restaurant and order.restaurant.owner_id == request.user.id)):
            return Response({"detail": "Permission refusée."}, status=status.HTTP_403_FORBIDDEN)
        if order.client_rating is None:
            return Response({"detail": "Cette commande n'a pas d'avis."}, status=status.HTTP_400_BAD_REQUEST)
        reply = str(request.data.get("reply", "")).strip()[:1000]
        order.owner_reply = reply
        order.owner_reply_at = timezone.now() if reply else None
        order.save(update_fields=["owner_reply", "owner_reply_at"])
        return Response({"owner_reply": order.owner_reply or None, "owner_reply_at": order.owner_reply_at})

    @action(detail=False, methods=["get"], url_path="reviews")
    def reviews(self, request):
        """GET /api/v1/orders/reviews/?restaurant=<id> — avis reçus (restaurateur), avec réponses."""
        restaurant, err = self._restaurant_or_403(request, request.query_params.get("restaurant"))
        if err:
            return err
        from .models import Order as OrderModel
        qs = (OrderModel.objects.filter(restaurant=restaurant, client_rating__isnull=False)
              .select_related("client").prefetch_related("items").order_by("-rated_at", "-updated_at"))
        data = [{
            "id": str(o.id), "number": o.number, "rating": o.client_rating, "comment": o.client_comment,
            "client_name": o.client.full_name if o.client else "Client supprimé",
            "date": (o.rated_at or o.updated_at), "items": [f"{l.qty}× {l.name}" for l in o.items.all()],
            "owner_reply": o.owner_reply or None, "owner_reply_at": o.owner_reply_at,
        } for o in qs]
        n = len(data)
        avg = round(sum(d["rating"] for d in data) / n, 2) if n else None
        dist = {str(i): sum(1 for d in data if d["rating"] == i) for i in range(1, 6)}
        return Response({"reviews": data, "count": n, "average": avg, "distribution": dist,
                         "unanswered": sum(1 for d in data if d["comment"] and not d["owner_reply"])})

    # ── WebSocket helpers ──────────────────────────────────────────────────────
    def _notify_restaurant(self, order, event_type):
        channel_layer = get_channel_layer()
        group_name = f"restaurant_{order.restaurant_id}"
        async_to_sync(channel_layer.group_send)(group_name, {
            "type":  "order.event",
            "event": event_type,
            "order": order_to_dict(order),
        })

    def _notify_all(self, order, event_type):
        """WebSocket (restaurant + client) puis notification push : chaque canal est indépendant."""
        try:
            self._notify_restaurant(order, event_type)
        except Exception as e:
            print(f"[WS] Erreur notification restaurant: {e}")
        if not order.client_id:   # vente comptoir : pas de client à prévenir
            return
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(f"client_{order.client_id}", {
                "type":  "order.event",
                "event": event_type,
                "order": order_to_dict(order),
            })
        except Exception as e:
            print(f"[WS] Erreur notification client: {e}")
        if event_type == "status_update":
            try:
                notify_order_status(order)   # push (si le client est abonné)
            except Exception as e:
                print(f"[Push] Erreur : {e}")
            if order.status == Order.READY:
                try:
                    emails.order_ready(order)
                except Exception as e:
                    print(f"[Mail] Erreur prête : {e}")


class PromoCodeViewSet(viewsets.ModelViewSet):
    """CRUD /api/v1/orders/promos/?restaurant=<id> — codes promo du restaurateur."""
    serializer_class   = PromoCodeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        restaurant = get_owned_restaurant(self.request.user, self.request.query_params.get("restaurant"))
        if restaurant is not None:
            return PromoCode.objects.filter(restaurant=restaurant)
        if self.request.user.is_admin_user:
            return scope_by_restaurant(PromoCode.objects.all())
        return scope_by_restaurant(PromoCode.objects.filter(restaurant__owner=self.request.user))

    def perform_create(self, serializer):
        restaurant = serializer.validated_data.get("restaurant")
        if get_owned_restaurant(self.request.user, restaurant.id) is None:
            self.permission_denied(self.request, message="Vous n'êtes pas propriétaire de ce restaurant.")
        serializer.save()


class DailyClosureViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                          viewsets.GenericViewSet):
    """
    Clôtures de journée (Z de caisse).
    GET  /api/v1/orders/closures/?restaurant=<id>            — historique
    GET  /api/v1/orders/closures/preview/?restaurant=&date=  — aperçu du jour sans enregistrer
    POST /api/v1/orders/closures/  {"restaurant", "date"?, "note"?}
    """
    serializer_class   = DailyClosureSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = scope_by_restaurant(DailyClosure.objects.select_related("restaurant", "closed_by"))
        if user.is_admin_user:
            pass
        elif user.is_restaurateur:
            qs = qs.filter(restaurant__owner=user)
        else:
            return qs.none()
        if self.request.query_params.get("restaurant"):
            qs = qs.filter(restaurant_id=self.request.query_params["restaurant"])
        return qs

    @staticmethod
    def _parse_date(value):
        if not value:
            return timezone.localdate()
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None

    @action(detail=False, methods=["get"], url_path="preview")
    def preview(self, request):
        restaurant = get_owned_restaurant(request.user, request.query_params.get("restaurant"))
        if restaurant is None:
            return Response({"detail": "Restaurant introuvable ou accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        d = self._parse_date(request.query_params.get("date"))
        if d is None:
            return Response({"detail": "Date invalide."}, status=status.HTTP_400_BAD_REQUEST)
        data = reports.closure_data(restaurant, d)
        existing = DailyClosure.objects.filter(restaurant=restaurant, date=d).first()
        data["already_closed"] = existing.id if existing else None
        return Response(data)

    def create(self, request, *args, **kwargs):
        restaurant = get_owned_restaurant(request.user, request.data.get("restaurant"))
        if restaurant is None:
            return Response({"detail": "Restaurant introuvable ou accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        d = self._parse_date(request.data.get("date"))
        if d is None:
            return Response({"detail": "Date invalide."}, status=status.HTTP_400_BAD_REQUEST)
        if d > timezone.localdate():
            return Response({"detail": "Impossible de clôturer une journée future."}, status=status.HTTP_400_BAD_REQUEST)
        if DailyClosure.objects.filter(restaurant=restaurant, date=d).exists():
            return Response({"detail": f"La journée du {d.strftime('%d/%m/%Y')} est déjà clôturée."}, status=status.HTTP_400_BAD_REQUEST)
        data = reports.closure_data(restaurant, d)
        data.pop("date")
        closure = DailyClosure.objects.create(restaurant=restaurant, date=d, closed_by=request.user,
                                              note=str(request.data.get("note", ""))[:2000], **data)
        return Response(DailyClosureSerializer(closure).data, status=status.HTTP_201_CREATED)
