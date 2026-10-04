"""restaurants/views.py"""
from rest_framework import viewsets, permissions, status, parsers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.throttling import UserRateThrottle


class PinUnlockThrottle(UserRateThrottle):
    """Limite les essais de PIN (force brute sur le code gérant du mode caissier) : taux « pin_unlock » des réglages."""
    scope = "pin_unlock"
from django_filters.rest_framework import DjangoFilterBackend
from django.utils import timezone
from .models import Restaurant, BusinessHours, Report, Employee, Favorite, RestaurantPhoto
from .serializers import RestaurantSerializer, RestaurantDetailSerializer, BusinessHoursSerializer, ReportSerializer, EmployeeSerializer
from .access import get_owned_restaurant
from apps.tenant.context import is_single_mode, scope_restaurants, single_mode_denied


class RestaurantViewSet(viewsets.ModelViewSet):
    filter_backends  = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["status", "is_open", "is_featured", "city", "owner"]
    search_fields    = ["name", "description", "cuisine", "city"]
    ordering_fields  = ["avg_rating", "total_orders", "created_at", "name"]
    ordering         = ["-is_featured", "-avg_rating"]

    def get_queryset(self):
        qs = Restaurant.objects.select_related("owner").prefetch_related("hours", "categories", "gallery")
        user = self.request.user
        if is_single_mode():
            # Mode mono-restaurant : seul le restaurant lié existe pour l'API (tout autre identifiant → 404) ;
            # il est actif par construction, l'étape de validation n'existe pas.
            return scope_restaurants(qs)
        if getattr(user, "is_admin_user", False):
            return qs
        # Public : seuls les restaurants validés ; un propriétaire voit aussi les siens (en attente, suspendus)
        from django.db.models import Q
        cond = Q(status=Restaurant.ACTIVE)
        if user.is_authenticated:
            cond |= Q(owner=user)
        return qs.filter(cond)

    def get_serializer_class(self):
        if self.action == "retrieve":
            return RestaurantDetailSerializer
        return RestaurantSerializer

    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in ["list", "retrieve"]:
            return [permissions.AllowAny()]
        # Les actions déclarées avec permission_classes=[…] (avis publics, favoris) sont respectées
        return [p() for p in self.permission_classes]

    def _check_owner(self, restaurant):
        if restaurant.owner_id != self.request.user.id and not self.request.user.is_admin_user:
            self.permission_denied(self.request, message="Vous n'êtes pas propriétaire de ce restaurant.")

    def perform_update(self, serializer):
        self._check_owner(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._check_owner(instance)
        if is_single_mode():
            self.permission_denied(self.request, message="Le restaurant lié à cette instance ne peut pas être supprimé depuis l'application.")
        instance.delete()

    def create(self, request, *args, **kwargs):
        if is_single_mode():
            return single_mode_denied("Cette application est dédiée à un seul restaurant : aucune création possible.")
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=["patch"], url_path="validate")
    def validate_restaurant(self, request, pk=None):
        if is_single_mode():
            return single_mode_denied()
        if not request.user.is_admin_user:
            return Response({"detail": "Permission refusée."}, status=403)
        restaurant = self.get_object()
        restaurant.status = Restaurant.ACTIVE
        restaurant.save(update_fields=["status"])
        return Response({"status": "active"})

    @action(detail=True, methods=["patch"], url_path="suspend")
    def suspend(self, request, pk=None):
        if is_single_mode():
            return single_mode_denied()
        if not request.user.is_admin_user:
            return Response({"detail": "Permission refusée."}, status=403)
        restaurant = self.get_object()
        restaurant.status = Restaurant.SUSPENDED
        restaurant.save(update_fields=["status"])
        return Response({"status": "suspended"})

    @action(detail=True, methods=["patch"], url_path="toggle-open")
    def toggle_open(self, request, pk=None):
        restaurant = self.get_object()
        if restaurant.owner != request.user and not request.user.is_admin_user:
            return Response({"detail": "Permission refusée."}, status=403)
        restaurant.is_open = not restaurant.is_open
        restaurant.save(update_fields=["is_open"])
        return Response({"is_open": restaurant.is_open, "is_open_now": restaurant.is_open_now, "open_status": restaurant.open_status})

    @action(detail=True, methods=["post"], url_path="upload-logo",
            parser_classes=[parsers.MultiPartParser],
            permission_classes=[permissions.IsAuthenticated])
    def upload_logo(self, request, pk=None):
        """POST /api/v1/restaurants/{id}/upload-logo/ — Upload logo via multipart"""
        restaurant = self.get_object()
        if restaurant.owner != request.user and not request.user.is_admin_user:
            return Response({"detail": "Permission refusée."}, status=403)
        if "logo" not in request.FILES:
            return Response({"detail": "Champ 'logo' requis."}, status=400)
        file = request.FILES["logo"]
        if file.size > 5 * 1024 * 1024:
            return Response({"detail": "Image trop grande (max 5 MB)."}, status=400)
        if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
            return Response({"detail": "Format non supporté. Utilisez JPEG, PNG ou WebP."}, status=400)
        # Identifiant unique à chaque envoi : l'URL change, aucun cache (CDN, navigateur) ne peut montrer l'ancien logo
        from apps.menus.views import cloudinary_upload, cloudinary_destroy
        import uuid as _uuid
        old = restaurant.logo.name if restaurant.logo else None
        public_id = cloudinary_upload(file, "restaurants/logos", f"{restaurant.id}-{_uuid.uuid4().hex[:8]}")
        if public_id:
            Restaurant.objects.filter(pk=restaurant.pk).update(logo=public_id)
            restaurant.refresh_from_db(fields=["logo"])
        else:
            restaurant.logo = file                       # sans Cloudinary : stockage local
            restaurant.save(update_fields=["logo"])
        if old and old != restaurant.logo.name:
            cloudinary_destroy(old)
        serializer = RestaurantSerializer(restaurant, context={"request": request})
        return Response({"logo_url": serializer.data["logo_url"]})

    def perform_create(self, serializer):
        import re, uuid
        from apps.menus.models import Category
        if not (self.request.user.is_restaurateur or self.request.user.is_admin_user):
            self.permission_denied(self.request, message="Seul un compte restaurateur peut créer un restaurant.")
        name = serializer.validated_data.get("name", "")
        base = re.sub(r"[^a-z0-9-]", "", name.lower().replace(" ", "-"))
        slug = (base + "-" if base else "") + str(uuid.uuid4())[:8]
        restaurant = serializer.save(owner=self.request.user, slug=slug)
        if not Category.objects.filter(restaurant=restaurant).exists():
            for i, n in enumerate(["Entrees", "Plats", "Desserts", "Boissons"]):
                Category.objects.create(restaurant=restaurant, name=n, order=i)

    @action(detail=True, methods=["get"], url_path="reviews", permission_classes=[permissions.AllowAny])
    def reviews(self, request, pk=None):
        """GET /api/v1/restaurants/{id}/reviews/ — Avis clients publics"""
        from apps.orders.models import Order
        restaurant = self.get_object()
        qs = (
            Order.objects
            .filter(restaurant=restaurant, client_rating__isnull=False)
            .select_related("client")
            .order_by("-updated_at")
        )
        data = [
            {
                "id":          str(o.id),
                "rating":      o.client_rating,
                "comment":     o.client_comment,
                "client_name": o.client.full_name if o.client else "Client anonyme",
                "date":        (o.rated_at or o.updated_at).strftime("%d/%m/%Y"),
                "owner_reply": o.owner_reply or None,
                "owner_reply_date": o.owner_reply_at.strftime("%d/%m/%Y") if o.owner_reply_at else None,
            }
            for o in qs
        ]
        return Response(data)

    # ── Galerie du lieu ───────────────────────────────────────────────────────
    def _gallery_response(self, restaurant):
        restaurant = Restaurant.objects.prefetch_related("hours", "gallery").get(pk=restaurant.pk)
        return Response({"restaurant": RestaurantSerializer(restaurant, context={"request": self.request}).data})

    @action(detail=True, methods=["post"], url_path="photos", parser_classes=[parsers.MultiPartParser, parsers.FormParser],
            permission_classes=[permissions.IsAuthenticated])
    def add_photo(self, request, pk=None):
        """POST /restaurants/{id}/photos/ (multipart 'image', 'caption' optionnel) — photo du lieu (10 max)."""
        from apps.menus.views import validate_image_file, cloudinary_upload
        restaurant = self.get_object()
        self._check_owner(restaurant)
        file, err = validate_image_file(request)
        if err:
            return err
        if restaurant.gallery.count() >= RestaurantPhoto.MAX_PHOTOS:
            return Response({"detail": f"Maximum {RestaurantPhoto.MAX_PHOTOS} photos du restaurant."}, status=400)
        import uuid as _uuid
        photo = RestaurantPhoto(restaurant=restaurant, caption=str(request.data.get("caption", ""))[:80], order=restaurant.gallery.count())
        public_id = cloudinary_upload(file, f"restaurants/{restaurant.id}/gallery", str(_uuid.uuid4()))
        if public_id:
            photo.image = public_id
        else:
            photo.image = file
        photo.save()
        if not restaurant.banner:            # première photo du lieu → bannière par défaut
            Restaurant.objects.filter(pk=restaurant.pk).update(banner=photo.image.name)
        return self._gallery_response(restaurant)

    @action(detail=True, methods=["delete", "patch", "post"], url_path=r"photos/(?P<photo_id>\d+)", permission_classes=[permissions.IsAuthenticated])
    def manage_photo(self, request, pk=None, photo_id=None):
        """DELETE : retire la photo · PATCH {"caption"} : légende · POST : en fait la bannière."""
        from apps.menus.views import cloudinary_destroy
        restaurant = self.get_object()
        self._check_owner(restaurant)
        try:
            photo = restaurant.gallery.get(pk=photo_id)
        except RestaurantPhoto.DoesNotExist:
            return Response({"detail": "Photo introuvable."}, status=404)
        if request.method == "DELETE":
            if restaurant.banner and restaurant.banner.name == photo.image.name:
                Restaurant.objects.filter(pk=restaurant.pk).update(banner=None)
            else:
                cloudinary_destroy(photo.image.name)
            photo.delete()
        elif request.method == "PATCH":
            photo.caption = str(request.data.get("caption", ""))[:80]
            photo.save(update_fields=["caption"])
        else:
            Restaurant.objects.filter(pk=restaurant.pk).update(banner=photo.image.name)
        return self._gallery_response(restaurant)

    # ── Favoris ───────────────────────────────────────────────────────────────
    @action(detail=False, methods=["get"], url_path="favorites", permission_classes=[permissions.IsAuthenticated])
    def favorites(self, request):
        """GET /api/v1/restaurants/favorites/ — identifiants des restaurants favoris de l'utilisateur."""
        ids = Favorite.objects.filter(user=request.user).values_list("restaurant_id", flat=True)
        return Response({"restaurants": [str(i) for i in ids]})

    @action(detail=True, methods=["post"], url_path="favorite", permission_classes=[permissions.IsAuthenticated])
    def toggle_favorite(self, request, pk=None):
        """POST /api/v1/restaurants/{id}/favorite/ — ajoute ou retire des favoris."""
        restaurant = self.get_object()
        fav = Favorite.objects.filter(user=request.user, restaurant=restaurant).first()
        if fav:
            fav.delete()
            return Response({"is_favorite": False})
        Favorite.objects.create(user=request.user, restaurant=restaurant)
        return Response({"is_favorite": True})

    @action(detail=True, methods=["get", "put"], url_path="hours")
    def manage_hours(self, request, pk=None):
        """GET /PUT /api/v1/restaurants/{id}/hours/ — Horaires d'ouverture"""
        restaurant = self.get_object()
        if restaurant.owner != request.user and not request.user.is_admin_user:
            return Response({"detail": "Permission refusée."}, status=403)

        if request.method == "GET":
            hours = BusinessHours.objects.filter(restaurant=restaurant).order_by("day_of_week")
            return Response(BusinessHoursSerializer(hours, many=True).data)

        # PUT — bulk upsert des 7 jours
        days_data = request.data
        if not isinstance(days_data, list):
            return Response({"detail": "Format invalide : attendu une liste."}, status=400)
        ser = BusinessHoursSerializer(data=days_data, many=True)
        if not ser.is_valid():
            return Response({"detail": "Horaires invalides.", "errors": ser.errors}, status=400)
        result = []
        for day in ser.validated_data:
            obj, _ = BusinessHours.objects.update_or_create(
                restaurant=restaurant,
                day_of_week=day["day_of_week"],
                defaults={
                    "is_open":     day.get("is_open", True),
                    "open_time":   day.get("open_time") or "11:30",
                    "close_time":  day.get("close_time") or "22:00",
                },
            )
            result.append(obj)
        result.sort(key=lambda x: x.day_of_week)
        return Response(BusinessHoursSerializer(result, many=True).data)

    @action(detail=True, methods=["get", "patch"], url_path="contract")
    def update_contract(self, request, pk=None):
        """GET /PATCH /api/v1/restaurants/{id}/contract/ — Admin uniquement (sans objet en mode mono-restaurant : la licence est gérée hors application)"""
        if is_single_mode():
            return single_mode_denied("La licence marque blanche est gérée par l'éditeur, hors application.")
        if not request.user.is_admin_user:
            return Response({"detail": "Permission refusée."}, status=403)
        restaurant = self.get_object()
        if request.method == "GET":
            return Response(RestaurantSerializer(restaurant).data)
        fields = ["contract_model", "commission_pct", "monthly_fee", "featured_fee",
                  "admin_manages_menu", "contract_notes", "is_featured", "contract_paid",
                  "invoicing_day"]
        for field in fields:
            if field in request.data:
                setattr(restaurant, field, request.data[field])
        restaurant.save()
        return Response(RestaurantSerializer(restaurant).data)


class ReportViewSet(viewsets.ModelViewSet):
    """ViewSet pour les signalements"""
    serializer_class = ReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.request.user.is_admin_user:
            return Report.objects.select_related("restaurant", "reporter").all()
        return Report.objects.filter(reporter=self.request.user)

    def perform_create(self, serializer):
        serializer.save(reporter=self.request.user)

    @action(detail=True, methods=["patch"], url_path="resolve")
    def resolve(self, request, pk=None):
        if not request.user.is_admin_user:
            return Response({"detail": "Permission refusée."}, status=403)
        report = self.get_object()
        report.status = "resolved"
        report.save(update_fields=["status"])
        return Response(ReportSerializer(report).data)


class EmployeeViewSet(viewsets.ModelViewSet):
    """
    CRUD /api/v1/restaurants/employees/?restaurant=<id> — équipe du restaurant (propriétaire ou admin).
    POST /api/v1/restaurants/employees/unlock/ {"restaurant", "pin", "purpose": "enter"|"exit"}
         → identifie l'employé par son PIN (exit : réservé aux gérants).
    """
    serializer_class   = EmployeeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        restaurant = get_owned_restaurant(self.request.user, self.request.query_params.get("restaurant"))
        if restaurant is not None:
            return Employee.objects.filter(restaurant=restaurant)
        if self.request.user.is_admin_user:
            return Employee.objects.all()
        return Employee.objects.filter(restaurant__owner=self.request.user)

    def perform_create(self, serializer):
        restaurant = serializer.validated_data.get("restaurant")
        if get_owned_restaurant(self.request.user, restaurant.id) is None:
            self.permission_denied(self.request, message="Vous n'êtes pas propriétaire de ce restaurant.")
        serializer.save()

    @action(detail=False, methods=["post"], url_path="unlock", throttle_classes=[PinUnlockThrottle])
    def unlock(self, request):
        restaurant = get_owned_restaurant(request.user, request.data.get("restaurant"))
        if restaurant is None:
            return Response({"detail": "Restaurant introuvable ou accès refusé."}, status=403)
        pin = str(request.data.get("pin", ""))
        purpose = request.data.get("purpose", "enter")
        qs = Employee.objects.filter(restaurant=restaurant, is_active=True)
        if purpose == "exit":
            qs = qs.filter(role=Employee.MANAGER)
        if not qs.exists():
            # Aucun employé (ou aucun gérant) défini : pas de verrou
            return Response({"employee": None, "locked": False})
        if not pin.isdigit():
            return Response({"detail": "Code incorrect."}, status=400)
        for emp in qs:
            if emp.check_pin(pin):
                emp.last_login_at = timezone.now()
                emp.save(update_fields=["last_login_at"])
                return Response({"employee": EmployeeSerializer(emp).data, "locked": True})
        return Response({"detail": "Code incorrect."}, status=400)
