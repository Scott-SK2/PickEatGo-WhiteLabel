"""
menus/stock.py — Service de gestion du stock (plats et ingrédients).

Deux niveaux coexistent et se combinent :
  • le stock par plat (MenuItem.stock_qty, compté à l'unité, optionnel) ;
  • la recette (RecipeLine) qui relie un plat à ses ingrédients : chaque vente
    consomme les ingrédients, et le nombre de portions réalisables limite le plat.

Toute variation passe par apply_movement() (plat) ou apply_ingredient_movement()
(ingrédient) : quantité mise à jour, disponibilité synchronisée, mouvement tracé.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Q

from .models import MenuItem, StockMovement, Ingredient, IngredientMovement, RecipeLine


# ══════════════════════════════════════════════════════════════════════════════
# Disponibilité
# ══════════════════════════════════════════════════════════════════════════════
def sync_availability(item):
    """
    Retire le plat de la carte quand il n'est plus vendable (stock du plat ou
    ingrédients épuisés) et le remet quand il l'est à nouveau — uniquement s'il
    avait été retiré automatiquement (un retrait manuel est respecté).
    """
    es = item.effective_stock
    fields = []
    if es is not None and es <= 0 and item.is_available:
        item.is_available, item.auto_disabled = False, True
        fields = ["is_available", "auto_disabled"]
    elif (es is None or es > 0) and item.auto_disabled:
        item.is_available, item.auto_disabled = True, False
        fields = ["is_available", "auto_disabled"]
    if fields:
        item.save(update_fields=fields + ["updated_at"])
    return item


def sync_items_using(ingredients):
    """Resynchronise la disponibilité de tous les plats dont la recette utilise ces ingrédients."""
    ids = [getattr(i, "pk", i) for i in ingredients]
    if not ids:
        return
    items = (MenuItem.objects.filter(recipe__ingredient_id__in=ids).distinct()
             .prefetch_related("recipe__ingredient"))
    for item in items:
        sync_availability(item)


def refresh_item_cost(item):
    """Quand un plat a une recette, son prix de revient est calculé depuis les ingrédients."""
    cost = item.recipe_cost
    if cost is not None:
        cost = cost.quantize(Decimal("0.01"))
        if item.cost_price != cost:
            item.cost_price = cost
            item.save(update_fields=["cost_price", "updated_at"])
    return item


def refresh_costs_using(ingredient):
    for item in MenuItem.objects.filter(recipe__ingredient=ingredient).distinct().prefetch_related("recipe__ingredient"):
        refresh_item_cost(item)


# ══════════════════════════════════════════════════════════════════════════════
# Stock par plat
# ══════════════════════════════════════════════════════════════════════════════
@transaction.atomic
def apply_movement(item, delta, reason, *, order=None, user=None, note="", set_qty=None, unit_cost=None):
    """
    Applique un mouvement de stock sur un plat et retourne le StockMovement créé.

    delta    : variation (+ entrée, − sortie). Ignoré si set_qty est fourni.
    set_qty  : fixe le stock à cette valeur (inventaire) et active le suivi si besoin.
    """
    item = MenuItem.objects.select_for_update().get(pk=item.pk)

    if set_qty is not None:
        delta = int(set_qty) - (item.stock_qty or 0)

    qty_after = None
    if item.track_stock or set_qty is not None:
        qty_after = max(0, (item.stock_qty or 0) + delta)
        item.stock_qty = qty_after
        item.save(update_fields=["stock_qty", "updated_at"])
    sync_availability(item)

    if unit_cost is None and reason == StockMovement.WASTE:
        unit_cost = item.cost_price

    return StockMovement.objects.create(
        item=item, delta=delta, qty_after=qty_after, reason=reason,
        order=order, user=user, unit_cost=unit_cost, note=(note or "")[:200],
    )


@transaction.atomic
def untrack(item, user=None):
    """Désactive le suivi à l'unité (le plat redevient 'illimité', sauf limite par la recette)."""
    item = MenuItem.objects.select_for_update().get(pk=item.pk)
    item.stock_qty = None
    item.save(update_fields=["stock_qty", "updated_at"])
    return sync_availability(item)


# ══════════════════════════════════════════════════════════════════════════════
# Stock par ingrédient
# ══════════════════════════════════════════════════════════════════════════════
@transaction.atomic
def apply_ingredient_movement(ingredient, delta, reason, *, order=None, user=None, note="",
                              set_qty=None, unit_cost=None, sync=True):
    """
    Applique un mouvement sur un ingrédient (quantité en unité de l'ingrédient)
    et resynchronise les plats qui l'utilisent.
    """
    ingredient = Ingredient.objects.select_for_update().get(pk=ingredient.pk)
    delta = Decimal(str(delta))
    if set_qty is not None:
        delta = Decimal(str(set_qty)) - ingredient.stock_qty
    qty_after = max(Decimal("0"), ingredient.stock_qty + delta)
    ingredient.stock_qty = qty_after
    ingredient.save(update_fields=["stock_qty", "updated_at"])

    if unit_cost is None and reason in (IngredientMovement.WASTE, IngredientMovement.RESTOCK):
        unit_cost = ingredient.unit_cost

    mv = IngredientMovement.objects.create(
        ingredient=ingredient, delta=delta, qty_after=qty_after, reason=reason,
        order=order, user=user, unit_cost=unit_cost, note=(note or "")[:200],
    )
    if sync:
        sync_items_using([ingredient])
    return mv


# ══════════════════════════════════════════════════════════════════════════════
# Commandes
# ══════════════════════════════════════════════════════════════════════════════
def consume_for_order(order, user=None):
    """
    Décrémente, pour chaque ligne de la commande :
      • le stock du plat s'il est suivi à l'unité ;
      • les ingrédients de sa recette (qté par portion × quantité vendue).
    """
    touched = set()
    for line in order.items.select_related("menu_item"):
        mi = line.menu_item
        if mi is None:
            continue
        for rl in RecipeLine.objects.filter(item=mi).select_related("ingredient"):
            apply_ingredient_movement(rl.ingredient, -(rl.qty * line.qty), IngredientMovement.SALE,
                                      order=order, user=user, sync=False)
            touched.add(rl.ingredient_id)
        if mi.track_stock:
            locked = MenuItem.objects.select_for_update().get(pk=mi.pk)
            if locked.stock_qty is not None and locked.stock_qty < line.qty:
                raise ValueError(f"Stock insuffisant pour « {mi.name} » ({locked.stock_qty} restant).")
            apply_movement(locked, -line.qty, StockMovement.SALE, order=order, user=user)
    # Un seul passage pour tous les plats touchés par les ingrédients consommés
    sync_items_using(touched)


def restore_for_order(order, user=None):
    """Restitue ce qu'une commande annulée avait consommé (plats et ingrédients)."""
    for mv in StockMovement.objects.filter(order=order, reason=StockMovement.SALE).select_related("item"):
        if mv.item.track_stock:
            apply_movement(mv.item, -mv.delta, StockMovement.CANCEL, order=order, user=user)
    touched = set()
    for mv in IngredientMovement.objects.filter(order=order, reason=IngredientMovement.SALE).select_related("ingredient"):
        apply_ingredient_movement(mv.ingredient, -mv.delta, IngredientMovement.CANCEL, order=order, user=user, sync=False)
        touched.add(mv.ingredient_id)
    if touched:
        sync_items_using(touched)


def check_availability(menu_item, qty):
    """Message d'erreur si le plat ne peut pas être vendu `qty` fois, sinon None."""
    es = menu_item.effective_stock
    if es is None or es >= qty:
        return None
    portions = menu_item.portions_available
    by_recipe = portions is not None and (not menu_item.track_stock or portions < menu_item.stock_qty)
    suffix = f", limité par {menu_item.limited_by}" if by_recipe else ""
    return f"Stock insuffisant pour « {menu_item.name} » (reste {es}{suffix})."


# ══════════════════════════════════════════════════════════════════════════════
# Alertes et liste de courses
# ══════════════════════════════════════════════════════════════════════════════
def stock_alerts(restaurant):
    """Plats épuisés et plats sous le seuil d'alerte (stock à l'unité ou recette)."""
    items = (MenuItem.objects
             .filter(category__restaurant=restaurant)
             .filter(Q(stock_qty__isnull=False) | Q(recipe__isnull=False))
             .distinct()
             .select_related("category")
             .prefetch_related("recipe__ingredient"))
    out = sorted([i for i in items if i.is_out_of_stock], key=lambda i: i.name)
    low = sorted([i for i in items if i.is_low_stock], key=lambda i: (i.effective_stock, i.name))
    return {"out": out, "low": low}


def ingredient_alerts(restaurant):
    ings = Ingredient.objects.filter(restaurant=restaurant, is_active=True).select_related("supplier").order_by("stock_qty", "name")
    return {"out": [i for i in ings if i.is_out_of_stock],
            "low": [i for i in ings if i.is_low_stock]}


def shopping_list(restaurant):
    """Ingrédients à commander, groupés par fournisseur."""
    alerts = ingredient_alerts(restaurant)
    groups = {}
    for ing in alerts["out"] + alerts["low"]:
        key = ing.supplier_id or 0
        g = groups.setdefault(key, {"supplier": ing.supplier, "lines": [], "total": Decimal("0")})
        qty = ing.suggested_order
        cost = (qty * ing.unit_cost).quantize(Decimal("0.01"))
        g["lines"].append({"ingredient": ing, "qty": qty, "cost": cost})
        g["total"] += cost
    return sorted(groups.values(), key=lambda g: (g["supplier"] is None, g["supplier"].name if g["supplier"] else ""))
