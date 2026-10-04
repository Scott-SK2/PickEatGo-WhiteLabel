"""menus/views.py — CRUD plats + upload photo"""
from rest_framework import viewsets, permissions, status, parsers
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
import django_filters
from rest_framework.pagination import PageNumberPagination
from decimal import Decimal, InvalidOperation
from django.db import transaction
from .models import Category, MenuItem, MenuItemOption, MenuItemPhoto, StockMovement, Supplier, Ingredient, RecipeLine, IngredientMovement
from .serializers import (CategorySerializer, MenuItemSerializer, MenuItemWriteSerializer, StockMovementSerializer, MenuItemPhotoSerializer,
                          SupplierSerializer, IngredientSerializer, IngredientMovementSerializer, RecipeWriteSerializer)
from .permissions import IsRestaurantOwnerOrAdmin
from .stock import (apply_movement, untrack, stock_alerts, apply_ingredient_movement, ingredient_alerts,
                    shopping_list, refresh_item_cost, refresh_costs_using, sync_availability, sync_items_using)
from apps.restaurants.access import get_owned_restaurant
from apps.tenant.context import scope_by_restaurant


ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"]


def _parse_date(value):
    """'AAAA-MM-JJ' → date, sinon None (une valeur invalide est ignorée au lieu de provoquer une erreur 500)."""
    from datetime import date
    try:
        return date.fromisoformat(str(value)) if value else None
    except ValueError:
        return None


def csv_safe(value):
    """Neutralise les formules dans les exports tableur (=, +, -, @ en début de cellule)."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def validate_image_file(request):
    """Retourne (fichier, None) ou (None, Response d'erreur) pour un upload multipart 'image'."""
    if "image" not in request.FILES:
        return None, Response({"detail": "Aucun fichier image fourni (champ 'image' requis)."}, status=status.HTTP_400_BAD_REQUEST)
    file = request.FILES["image"]
    if file.size > MAX_IMAGE_BYTES:
        return None, Response({"detail": "L'image ne doit pas dépasser 5 MB."}, status=status.HTTP_400_BAD_REQUEST)
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        return None, Response({"detail": "Format non supporté. Utilisez JPEG, PNG ou WebP."}, status=status.HTTP_400_BAD_REQUEST)
    return file, None


def cloudinary_upload(file, folder, public_id):
    """Upload direct Cloudinary → public_id, ou None si Cloudinary n'est pas configuré / échoue."""
    try:
        import cloudinary.uploader as _cu
        from django.conf import settings as _s
        _cs = getattr(_s, "CLOUDINARY_STORAGE", {})
        if not _cs.get("CLOUD_NAME"):
            return None
        prefix = _cs.get("PREFIX", "pickeatgo")
        result = _cu.upload(file, folder=f"{prefix}/{folder}", public_id=public_id, overwrite=True, resource_type="image")
        return result["public_id"]
    except Exception as e:
        print(f"[cloudinary_upload] échec : {e}")
        return None


def cloudinary_destroy(name):
    try:
        import cloudinary.uploader as _cu
        _cu.destroy(str(name), resource_type="image")
    except Exception:
        pass


class LargePagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 500


class MenuItemFilter(django_filters.FilterSet):
    """Permet de filtrer les plats par restaurant via ?restaurant=<id>"""
    restaurant = django_filters.UUIDFilter(field_name="category__restaurant__id")

    class Meta:
        model  = MenuItem
        fields = ["category", "is_available", "is_featured", "restaurant"]


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Lecture publique, écriture réservée au propriétaire du restaurant"""
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        restaurant = getattr(obj, "restaurant", None) or obj.category.restaurant
        return restaurant.owner == request.user or request.user.is_admin_user


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class   = CategorySerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    pagination_class   = LargePagination
    filter_backends    = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields   = ["restaurant", "is_active"]
    search_fields      = ["name"]
    ordering_fields    = ["order", "name"]

    def get_queryset(self):
        qs = scope_by_restaurant(Category.objects.select_related("restaurant").prefetch_related("items__options"))
        # Si le paramètre ?restaurant=<id> est fourni, le DjangoFilterBackend s'en charge.
        # Si un restaurateur accède sans filtre explicite, on limite à ses propres restaurants.
        user = self.request.user
        if (
            user.is_authenticated
            and user.is_restaurateur
            and "restaurant" not in self.request.query_params
        ):
            qs = qs.filter(restaurant__owner=user)
        return qs

    def _check_restaurant(self, restaurant):
        if restaurant is not None and not (restaurant.owner_id == self.request.user.id or self.request.user.is_admin_user):
            self.permission_denied(self.request, message="Vous n'êtes pas propriétaire de ce restaurant.")

    def perform_create(self, serializer):
        self._check_restaurant(serializer.validated_data.get("restaurant"))
        serializer.save()

    def perform_update(self, serializer):
        self._check_restaurant(serializer.instance.restaurant)
        self._check_restaurant(serializer.validated_data.get("restaurant"))
        serializer.save()


class MenuItemViewSet(viewsets.ModelViewSet):
    """
    CRUD des plats du menu.
    Upload photo : POST/PATCH avec Content-Type: multipart/form-data
    Champ image : fichier binaire (JPEG/PNG/WebP, max 5MB)
    """
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    pagination_class   = LargePagination
    filter_backends    = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class    = MenuItemFilter
    search_fields      = ["name", "description", "allergens"]
    ordering_fields    = ["price", "order", "name", "created_at"]

    # ── Parsers : accepte JSON (URL) ET multipart (fichier) ──────────────────
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]

    def get_queryset(self):
        qs = scope_by_restaurant(MenuItem.objects.select_related("category__restaurant").prefetch_related("options", "recipe__ingredient", "photos"), "category__restaurant")
        # Si un restaurateur accède sans filtre explicite par catégorie,
        # on limite aux plats de ses propres restaurants.
        user = self.request.user
        if (
            user.is_authenticated
            and user.is_restaurateur
            and "category" not in self.request.query_params
        ):
            qs = qs.filter(category__restaurant__owner=user)
        return qs

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return MenuItemWriteSerializer
        return MenuItemSerializer

    def perform_create(self, serializer):
        """Vérifie que l'utilisateur est propriétaire du restaurant de la catégorie"""
        category = serializer.validated_data["category"]
        if not (category.restaurant.owner == self.request.user or self.request.user.is_admin_user):
            self.permission_denied(self.request, message="Vous n'êtes pas propriétaire de ce restaurant.")
        serializer.save()

    def perform_update(self, serializer):
        """Un plat ne peut pas être déplacé dans la catégorie d'un autre restaurant."""
        category = serializer.validated_data.get("category")
        if category is not None and not (category.restaurant.owner == self.request.user or self.request.user.is_admin_user):
            self.permission_denied(self.request, message="Cette catégorie appartient à un autre restaurant.")
        serializer.save()

    @action(detail=True, methods=["post"], url_path="upload-image",
            parser_classes=[parsers.MultiPartParser])
    def upload_image(self, request, pk=None):
        """
        POST /api/v1/menus/items/{id}/upload-image/
        Body: multipart/form-data avec champ 'image'
        Retourne: { image_url: "https://res.cloudinary.com/..." }
        """
        item = self.get_object()

        if "image" not in request.FILES:
            return Response(
                {"detail": "Aucun fichier image fourni (champ 'image' requis)."},
                status=status.HTTP_400_BAD_REQUEST
            )

        file = request.FILES["image"]

        # Validation taille
        if file.size > 5 * 1024 * 1024:
            return Response(
                {"detail": "L'image ne doit pas dépasser 5 MB."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validation type MIME
        allowed_types = ["image/jpeg", "image/png", "image/webp"]
        if file.content_type not in allowed_types:
            return Response(
                {"detail": f"Format non supporté. Utilisez JPEG, PNG ou WebP."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Identifiant unique à chaque envoi : l'URL change, aucun cache ne peut montrer l'ancienne photo
        import uuid as _uuid
        old = item.image.name if item.image else None
        public_id = cloudinary_upload(file, f"menus/{item.category.restaurant_id}", f"{item.id}-{_uuid.uuid4().hex[:8]}")
        if public_id:
            MenuItem.objects.filter(pk=item.pk).update(image=public_id, image_alt=request.data.get("image_alt", item.name))
            item.refresh_from_db(fields=["image", "image_alt"])
        else:
            item.image = file                            # sans Cloudinary : stockage local
            item.image_alt = request.data.get("image_alt", item.name)
            item.save(update_fields=["image", "image_alt"])
        if old and old != item.image.name:
            cloudinary_destroy(old)
        url = MenuItemSerializer(item, context=self.get_serializer_context()).data.get("image_url")
        return Response({"image_url": url, "message": "Photo uploadée avec succès."}, status=status.HTTP_200_OK)

    # ── Galerie (photos supplémentaires) ───────────────────────────────────────
    def _item_response(self, item):
        item = MenuItem.objects.select_related("category__restaurant").prefetch_related("options", "recipe__ingredient", "photos").get(pk=item.pk)
        return Response({"item": MenuItemSerializer(item, context=self.get_serializer_context()).data})

    @action(detail=True, methods=["post"], url_path="photos", parser_classes=[parsers.MultiPartParser])
    def add_photo(self, request, pk=None):
        """POST /items/{id}/photos/ (multipart 'image') — ajoute une photo (5 au total, principale comprise)."""
        item = self.get_object()
        file, err = validate_image_file(request)
        if err:
            return err
        import uuid as _uuid
        total = item.photos.count() + (1 if item.image else 0)
        if total >= MenuItemPhoto.MAX_PHOTOS:
            return Response({"detail": f"Maximum {MenuItemPhoto.MAX_PHOTOS} photos par plat."}, status=status.HTTP_400_BAD_REQUEST)
        if not item.image:
            # Pas encore de photo principale : celle-ci le devient
            public_id = cloudinary_upload(file, f"menus/{item.category.restaurant_id}", f"{item.id}-{_uuid.uuid4().hex[:8]}")
            if public_id:
                MenuItem.objects.filter(pk=item.pk).update(image=public_id, image_alt=item.name)
            else:
                item.image = file; item.image_alt = item.name; item.save(update_fields=["image", "image_alt"])
            return self._item_response(item)
        photo = MenuItemPhoto(item=item, order=item.photos.count())
        public_id = cloudinary_upload(file, f"menus/{item.category.restaurant_id}/{item.id}", str(_uuid.uuid4()))
        if public_id:
            photo.image = public_id
            photo.save()
        else:
            photo.image = file
            photo.save()
        return self._item_response(item)

    @action(detail=True, methods=["delete", "post"], url_path=r"photos/(?P<photo_id>\d+)")
    def manage_photo(self, request, pk=None, photo_id=None):
        """DELETE /items/{id}/photos/{photo_id}/ — retire la photo ; POST — en fait la photo principale."""
        item = self.get_object()
        try:
            photo = item.photos.get(pk=photo_id)
        except MenuItemPhoto.DoesNotExist:
            return Response({"detail": "Photo introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if request.method == "DELETE":
            cloudinary_destroy(photo.image.name)
            photo.delete()
            return self._item_response(item)
        # Échange : l'ancienne principale devient une photo secondaire
        old_cover = item.image.name if item.image else None
        MenuItem.objects.filter(pk=item.pk).update(image=photo.image.name)
        if old_cover:
            photo.image = old_cover
            photo.save(update_fields=["image"])
        else:
            photo.delete()
        return self._item_response(item)

    # ── Stock ──────────────────────────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="stock")
    def adjust_stock(self, request, pk=None):
        """
        POST /api/v1/menus/items/{id}/stock/
        Body : {"mode": "set", "qty": 20}          → inventaire : fixe le stock (active le suivi)
               {"mode": "add", "qty": 10}          → réapprovisionnement
               {"mode": "add", "qty": -2}          → ajustement à la baisse
               {"track": false}                    → arrête le suivi (stock illimité)
        Optionnel : "note".
        """
        item = self.get_object()
        note = str(request.data.get("note", ""))
        ctx  = self.get_serializer_context()

        if request.data.get("track") is False:
            untrack(item, user=request.user)
            item.refresh_from_db()
            return Response({"item": MenuItemSerializer(item, context=ctx).data, "movement": None})

        try:
            qty = int(request.data.get("qty"))
        except (TypeError, ValueError):
            return Response({"detail": "Quantité invalide."}, status=status.HTTP_400_BAD_REQUEST)

        mode = request.data.get("mode", "add")
        if mode == "set":
            if qty < 0:
                return Response({"detail": "Le stock ne peut pas être négatif."}, status=status.HTTP_400_BAD_REQUEST)
            movement = apply_movement(item, 0, StockMovement.INVENTORY, user=request.user, note=note, set_qty=qty)
        else:
            if qty == 0:
                return Response({"detail": "Indiquez une quantité différente de zéro."}, status=status.HTTP_400_BAD_REQUEST)
            if not item.track_stock:
                return Response({"detail": "Activez d'abord le suivi de stock en fixant une quantité (inventaire)."},
                                status=status.HTTP_400_BAD_REQUEST)
            reason = StockMovement.RESTOCK if qty > 0 else StockMovement.ADJUST
            movement = apply_movement(item, qty, reason, user=request.user, note=note)

        item.refresh_from_db()
        return Response({"item": MenuItemSerializer(item, context=ctx).data,
                         "movement": StockMovementSerializer(movement).data})

    @action(detail=True, methods=["post"], url_path="waste")
    def declare_waste(self, request, pk=None):
        """
        POST /api/v1/menus/items/{id}/waste/  Body : {"qty": 3, "note": "invendus du soir"}
        Déclare une perte : décrémente le stock s'il est suivi, trace le mouvement valorisé au prix de revient.
        """
        item = self.get_object()
        try:
            qty = int(request.data.get("qty"))
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            return Response({"detail": "Quantité invalide."}, status=status.HTTP_400_BAD_REQUEST)
        movement = apply_movement(item, -qty, StockMovement.WASTE, user=request.user,
                                  note=str(request.data.get("note", "")))
        item.refresh_from_db()
        return Response({"item": MenuItemSerializer(item, context=self.get_serializer_context()).data,
                         "movement": StockMovementSerializer(movement).data})

    @action(detail=False, methods=["get"], url_path="stock-alerts")
    def stock_alerts_view(self, request):
        """GET /api/v1/menus/items/stock-alerts/?restaurant=<id> — plats et ingrédients épuisés / sous le seuil."""
        restaurant = get_owned_restaurant(request.user, request.query_params.get("restaurant"))
        if restaurant is None:
            return Response({"detail": "Restaurant introuvable ou accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        alerts = stock_alerts(restaurant)
        ing = ingredient_alerts(restaurant)
        ctx = self.get_serializer_context()
        return Response({
            "out":   MenuItemSerializer(alerts["out"], many=True, context=ctx).data,
            "low":   MenuItemSerializer(alerts["low"], many=True, context=ctx).data,
            "ingredients": {
                "out": IngredientSerializer(ing["out"], many=True, context=ctx).data,
                "low": IngredientSerializer(ing["low"], many=True, context=ctx).data,
            },
            "count": len(alerts["out"]) + len(alerts["low"]) + len(ing["out"]) + len(ing["low"]),
        })

    # ── Recette ────────────────────────────────────────────────────────────────
    @action(detail=True, methods=["get", "put"], url_path="recipe")
    def recipe(self, request, pk=None):
        """
        GET  /api/v1/menus/items/{id}/recipe/  → lignes de recette, coût matière, portions réalisables
        PUT  /api/v1/menus/items/{id}/recipe/  Body : {"lines": [{"ingredient": "<uuid>", "qty": 0.15}, …]}
             Remplace la recette. Une liste vide supprime la recette (retour au stock simple).
        """
        item = self.get_object()
        if request.method == "PUT":
            ser = RecipeWriteSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            restaurant = item.category.restaurant
            ids = [l["ingredient"] for l in ser.validated_data["lines"]]
            found = {i.id: i for i in Ingredient.objects.filter(restaurant=restaurant, id__in=ids)}
            if len(found) != len(ids):
                return Response({"detail": "Un ingrédient n'appartient pas à ce restaurant."}, status=status.HTTP_400_BAD_REQUEST)
            with transaction.atomic():
                item.recipe.all().delete()
                RecipeLine.objects.bulk_create([RecipeLine(item=item, ingredient=found[l["ingredient"]], qty=l["qty"])
                                                for l in ser.validated_data["lines"]])
                item = MenuItem.objects.prefetch_related("recipe__ingredient").get(pk=item.pk)
                refresh_item_cost(item)
                sync_availability(item)
        item = MenuItem.objects.select_related("category__restaurant").prefetch_related("options", "recipe__ingredient").get(pk=item.pk)
        return Response({"item": MenuItemSerializer(item, context=self.get_serializer_context()).data})

    @action(detail=True, methods=["delete"], url_path="delete-image")
    def delete_image(self, request, pk=None):
        """DELETE /api/v1/menus/items/{id}/delete-image/"""
        item = self.get_object()
        if item.image:
            item.image.delete(save=False)
            item.image = None
            item.save(update_fields=["image"])
        return Response({"message": "Photo supprimée."}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["patch"], url_path="toggle-availability")
    def toggle_availability(self, request, pk=None):
        """PATCH /api/v1/menus/items/{id}/toggle-availability/"""
        item = self.get_object()
        if not item.is_available and item.is_out_of_stock:
            return Response({"detail": "Stock épuisé : réapprovisionnez le plat pour le remettre à la carte."},
                            status=status.HTTP_400_BAD_REQUEST)
        item.is_available = not item.is_available
        item.auto_disabled = False  # choix manuel : on ne réactive plus automatiquement
        item.save(update_fields=["is_available", "auto_disabled"])
        return Response({"is_available": item.is_available})


class StockMovementViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/v1/menus/stock-movements/?restaurant=<id>[&item=&reason=&from=YYYY-MM-DD&to=YYYY-MM-DD]
    Historique des mouvements de stock d'un restaurant (propriétaire ou admin).
    """
    serializer_class   = StockMovementSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class   = LargePagination

    def get_queryset(self):
        params = self.request.query_params
        restaurant = get_owned_restaurant(self.request.user, params.get("restaurant"))
        if restaurant is None:
            return StockMovement.objects.none()
        qs = (StockMovement.objects
              .filter(item__category__restaurant=restaurant)
              .select_related("item", "order", "user"))
        if params.get("item"):
            qs = qs.filter(item_id=params["item"])
        if params.get("reason"):
            qs = qs.filter(reason=params["reason"])
        d_from, d_to = _parse_date(params.get("from")), _parse_date(params.get("to"))
        if d_from:
            qs = qs.filter(created_at__date__gte=d_from)
        if d_to:
            qs = qs.filter(created_at__date__lte=d_to)
        return qs


# ══════════════════════════════════════════════════════════════════════════════
# Fournisseurs et ingrédients
# ══════════════════════════════════════════════════════════════════════════════
class OwnedByRestaurantMixin:
    """Liste : ?restaurant=<id> obligatoire (propriétaire ou admin). Écriture : même contrôle sur l'objet."""
    permission_classes = [permissions.IsAuthenticated]
    pagination_class   = LargePagination

    def _scoped(self, model):
        restaurant = get_owned_restaurant(self.request.user, self.request.query_params.get("restaurant"))
        if restaurant is not None:
            return model.objects.filter(restaurant=restaurant)
        if self.request.user.is_admin_user:
            return scope_by_restaurant(model.objects.all())
        # Sans filtre : tout ce qui appartient aux restaurants de l'utilisateur (accès détail)
        return scope_by_restaurant(model.objects.filter(restaurant__owner=self.request.user))

    def _check_restaurant(self, serializer):
        restaurant = serializer.validated_data.get("restaurant")
        if restaurant and get_owned_restaurant(self.request.user, restaurant.id) is None:
            self.permission_denied(self.request, message="Vous n'êtes pas propriétaire de ce restaurant.")

    def perform_create(self, serializer):
        self._check_restaurant(serializer)
        serializer.save()


class SupplierViewSet(OwnedByRestaurantMixin, viewsets.ModelViewSet):
    """CRUD /api/v1/menus/suppliers/?restaurant=<id>"""
    serializer_class = SupplierSerializer

    def get_queryset(self):
        return self._scoped(Supplier).prefetch_related("ingredients")


class IngredientViewSet(OwnedByRestaurantMixin, viewsets.ModelViewSet):
    """
    CRUD /api/v1/menus/ingredients/?restaurant=<id>[&search=&alert=1]
    Actions : stock/ (inventaire / réappro), waste/, alerts/, shopping-list/
    """
    serializer_class = IngredientSerializer
    filter_backends  = [SearchFilter, OrderingFilter]
    search_fields    = ["name"]
    ordering_fields  = ["name", "stock_qty", "unit_cost", "updated_at"]

    def get_queryset(self):
        qs = self._scoped(Ingredient).select_related("supplier").prefetch_related("recipe_lines__item")
        if self.request.query_params.get("supplier"):
            qs = qs.filter(supplier_id=self.request.query_params["supplier"])
        return qs

    def perform_create(self, serializer):
        self._check_restaurant(serializer)
        initial = serializer.validated_data.get("stock_qty")
        ingredient = serializer.save(stock_qty=0)
        if initial:
            apply_ingredient_movement(ingredient, 0, IngredientMovement.INVENTORY, user=self.request.user,
                                      note="Stock initial", set_qty=initial)
            ingredient.refresh_from_db()

    def perform_update(self, serializer):
        old_cost = serializer.instance.unit_cost
        ingredient = serializer.save()
        if ingredient.unit_cost != old_cost:
            refresh_costs_using(ingredient)     # les plats qui l'utilisent ont un nouveau prix de revient

    def perform_destroy(self, instance):
        if instance.recipe_lines.exists():
            names = ", ".join(l.item.name for l in instance.recipe_lines.select_related("item")[:5])
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"detail": f"Cet ingrédient est utilisé dans une recette ({names}). Retirez-le des recettes avant de le supprimer."})
        instance.delete()

    def _respond(self, ingredient, movement=None):
        ingredient = Ingredient.objects.select_related("supplier").prefetch_related("recipe_lines__item").get(pk=ingredient.pk)
        return Response({"ingredient": IngredientSerializer(ingredient, context=self.get_serializer_context()).data,
                         "movement": IngredientMovementSerializer(movement).data if movement else None})

    @action(detail=True, methods=["post"], url_path="stock")
    def adjust_stock(self, request, pk=None):
        """
        POST /ingredients/{id}/stock/
        Body : {"mode": "set", "qty": 12.5}   → inventaire (fixe le stock)
               {"mode": "add", "qty": 5}      → réception / réapprovisionnement (qty < 0 : ajustement)
        Optionnel : "note", "unit_cost" (nouveau prix d'achat à la réception).
        """
        ingredient = self.get_object()
        try:
            qty = Decimal(str(request.data.get("qty")))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"detail": "Quantité invalide."}, status=status.HTTP_400_BAD_REQUEST)
        note = str(request.data.get("note", ""))
        mode = request.data.get("mode", "add")
        if request.data.get("unit_cost") not in (None, ""):
            try:
                new_cost = Decimal(str(request.data["unit_cost"]))
                if new_cost >= 0 and new_cost != ingredient.unit_cost:
                    ingredient.unit_cost = new_cost
                    ingredient.save(update_fields=["unit_cost", "updated_at"])
                    refresh_costs_using(ingredient)
            except InvalidOperation:
                return Response({"detail": "Prix d'achat invalide."}, status=status.HTTP_400_BAD_REQUEST)
        if mode == "set":
            if qty < 0:
                return Response({"detail": "Le stock ne peut pas être négatif."}, status=status.HTTP_400_BAD_REQUEST)
            mv = apply_ingredient_movement(ingredient, 0, IngredientMovement.INVENTORY, user=request.user, note=note, set_qty=qty)
        else:
            if qty == 0:
                return Response({"detail": "Indiquez une quantité différente de zéro."}, status=status.HTTP_400_BAD_REQUEST)
            reason = IngredientMovement.RESTOCK if qty > 0 else IngredientMovement.ADJUST
            mv = apply_ingredient_movement(ingredient, qty, reason, user=request.user, note=note)
        return self._respond(ingredient, mv)

    @action(detail=True, methods=["post"], url_path="waste")
    def declare_waste(self, request, pk=None):
        """POST /ingredients/{id}/waste/  Body : {"qty": 0.5, "note": "périmé"}"""
        ingredient = self.get_object()
        try:
            qty = Decimal(str(request.data.get("qty")))
        except (InvalidOperation, TypeError, ValueError):
            qty = Decimal("0")
        if qty <= 0:
            return Response({"detail": "Quantité invalide."}, status=status.HTTP_400_BAD_REQUEST)
        mv = apply_ingredient_movement(ingredient, -qty, IngredientMovement.WASTE, user=request.user,
                                       note=str(request.data.get("note", "")))
        return self._respond(ingredient, mv)

    @action(detail=False, methods=["get"], url_path="alerts")
    def alerts(self, request):
        restaurant = get_owned_restaurant(request.user, request.query_params.get("restaurant"))
        if restaurant is None:
            return Response({"detail": "Restaurant introuvable ou accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        a = ingredient_alerts(restaurant)
        ctx = self.get_serializer_context()
        return Response({"out": IngredientSerializer(a["out"], many=True, context=ctx).data,
                         "low": IngredientSerializer(a["low"], many=True, context=ctx).data,
                         "count": len(a["out"]) + len(a["low"])})

    @action(detail=False, methods=["get"], url_path="shopping-list")
    def shopping_list_view(self, request):
        """GET /ingredients/shopping-list/?restaurant=<id>[&type=csv] — à commander, groupé par fournisseur."""
        restaurant = get_owned_restaurant(request.user, request.query_params.get("restaurant"))
        if restaurant is None:
            return Response({"detail": "Restaurant introuvable ou accès refusé."}, status=status.HTTP_403_FORBIDDEN)
        groups = shopping_list(restaurant)
        if request.query_params.get("type") == "csv":
            import csv, io
            from django.http import HttpResponse
            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";")
            w.writerow(["Fournisseur", "Ingrédient", "Stock actuel", "Unité", "À commander", "Prix unitaire", "Coût estimé"])
            for g in groups:
                for l in g["lines"]:
                    ing = l["ingredient"]
                    w.writerow([csv_safe(g["supplier"].name if g["supplier"] else "Sans fournisseur"), csv_safe(ing.name),
                                str(ing.stock_qty).replace(".", ","), ing.get_unit_display(),
                                str(l["qty"]).replace(".", ","), str(ing.unit_cost).replace(".", ","), str(l["cost"]).replace(".", ",")])
            resp = HttpResponse("﻿" + buf.getvalue(), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = 'attachment; filename="liste-de-courses.csv"'
            return resp
        total = sum((g["total"] for g in groups), Decimal("0"))
        return Response({
            "groups": [{
                "supplier": SupplierSerializer(g["supplier"]).data if g["supplier"] else None,
                "total": str(g["total"]),
                "lines": [{"ingredient": IngredientSerializer(l["ingredient"], context=self.get_serializer_context()).data,
                           "qty": str(l["qty"]), "cost": str(l["cost"])} for l in g["lines"]],
            } for g in groups],
            "total": str(total),
            "count": sum(len(g["lines"]) for g in groups),
        })


class IngredientMovementViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/v1/menus/ingredient-movements/?restaurant=<id>[&ingredient=&reason=&from=&to=]"""
    serializer_class   = IngredientMovementSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class   = LargePagination

    def get_queryset(self):
        params = self.request.query_params
        restaurant = get_owned_restaurant(self.request.user, params.get("restaurant"))
        if restaurant is None:
            return IngredientMovement.objects.none()
        qs = IngredientMovement.objects.filter(ingredient__restaurant=restaurant).select_related("ingredient", "order", "user")
        if params.get("ingredient"):
            qs = qs.filter(ingredient_id=params["ingredient"])
        if params.get("reason"):
            qs = qs.filter(reason=params["reason"])
        d_from, d_to = _parse_date(params.get("from")), _parse_date(params.get("to"))
        if d_from:
            qs = qs.filter(created_at__date__gte=d_from)
        if d_to:
            qs = qs.filter(created_at__date__lte=d_to)
        return qs
