"""
Données de démonstration (local uniquement) : depuis backend/, `python manage.py shell < ../tools/seed_demo.py`.
Comptes créés (mot de passe Demo1234!) : marie@example.com (restauratrice, Burger House),
jean@example.com (client), admin@example.com (administration).
Employés de Burger House : Sarah (caissière, PIN 4826), Marco (gérant, PIN 7391).
"""
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from apps.accounts.models import User
from apps.restaurants.models import Restaurant, BusinessHours
from apps.menus.models import Category, MenuItem, StockMovement
from apps.menus.stock import apply_movement
from apps.orders.models import Order, OrderItem

User.objects.filter(email__in=["marie@example.com", "jean@example.com", "admin@example.com"]).delete()
admin = User.objects.create_user(email="admin@example.com", password="Demo1234!", first_name="Alice", last_name="Admin", role=User.ADMIN, is_staff=True, is_superuser=True)
marie = User.objects.create_user(email="marie@example.com", password="Demo1234!", first_name="Marie", last_name="Dupont", role=User.RESTAURATEUR, phone="+32 470 11 22 33")
jean  = User.objects.create_user(email="jean@example.com",  password="Demo1234!", first_name="Jean",  last_name="Martin", role=User.CLIENT, phone="+32 470 44 55 66")
resto = Restaurant.objects.create(owner=marie, name="Burger House", slug="burger-house", cuisine=["Américain"], address="12 Rue de la Paix, Bruxelles",
                                  city="Bruxelles", phone="+32 2 123 45 67", status=Restaurant.ACTIVE, is_open=True, emoji="🍔", banner_color="#FF6B2C",
                                  description="Les meilleurs burgers artisanaux de la ville.")
for d in range(7):
    BusinessHours.objects.create(restaurant=resto, day_of_week=d, is_open=d != 6, open_time="11:00", close_time="22:30")

cats = {n: Category.objects.create(restaurant=resto, name=n, order=i) for i, n in enumerate(["Entrées", "Plats", "Desserts", "Boissons"])}
def item(cat, name, price, cost=None, stock=None, thr=5, desc=""):
    return MenuItem.objects.create(category=cats[cat], name=name, price=Decimal(price), cost_price=Decimal(cost) if cost else None,
                                   stock_qty=stock, low_stock_threshold=thr, description=desc)
burger  = item("Plats",    "Burger Classic", "9.50", "3.10", 24, 6, "Bœuf, salade, tomate, oignon, ketchup maison")
bbq     = item("Plats",    "Burger BBQ",     "11.00", "3.80", 3, 5, "Sauce BBQ fumée, oignons caramélisés")
chicken = item("Plats",    "Chicken Crispy", "10.00", "3.40", 0, 4, "Poulet croustillant, mayo maison")
frites  = item("Entrées",  "Frites Maison",  "3.50", "0.70", None, 5, "Frites fraîches, sel, herbes")
rings   = item("Entrées",  "Onion Rings",    "4.00", "1.10", 40, 10)
tira    = item("Desserts", "Tiramisu",       "5.50", "1.60", 8, 4)
cola    = item("Boissons", "Cola 33cl",      "2.50", "0.60", 60, 12)
shake   = item("Boissons", "Milkshake",      "4.50", "1.20", None)
# Chicken épuisé → retiré de la carte
chicken.is_available = False; chicken.auto_disabled = True; chicken.save()

now = timezone.localtime()
n = 0
def make(days_ago, hour, lines, status="recuperee", otype="emporter", pay="", note=""):
    global n
    n += 1
    created = (now - timedelta(days=days_ago)).replace(hour=hour, minute=(n * 7) % 60, second=0, microsecond=0)
    o = Order.objects.create(client=None if otype == "comptoir" else jean, restaurant=resto, status=status, order_type=otype,
                             payment_method=pay, created_by=marie if otype == "comptoir" else None,
                             pickup_date=created.date(), pickup_slot=created.time(), note=note, total_price=0)
    total = Decimal(0)
    for it, q in lines:
        OrderItem.objects.create(order=o, menu_item=it, name=it.name, price=it.price, qty=q, options=[])
        total += it.price * q
    o.total_price = total; o.save(update_fields=["total_price"])
    Order.objects.filter(pk=o.pk).update(created_at=created, updated_at=created)
    return o

# Semaine passée : ventes en ligne + comptoir
for d in range(6, 0, -1):
    make(d, 12, [(burger, 2), (frites, 2), (cola, 2)], pay="carte")
    make(d, 13, [(bbq, 1), (rings, 1)], pay="especes", otype="comptoir")
    make(d, 19, [(burger, 1), (tira, 1)], pay="carte", otype="sur_place")
    if d % 2 == 0:
        make(d, 20, [(chicken, 2), (frites, 1), (shake, 1)], pay="especes", otype="comptoir")
    if d == 3:
        make(d, 18, [(burger, 1)], status="annulee")
# Aujourd'hui
make(0, 11, [(burger, 1), (frites, 1)], pay="especes", otype="comptoir")
make(0, 12, [(bbq, 2), (cola, 2)], pay="carte")
make(0, 12, [(tira, 2)], pay="carte", otype="comptoir")
make(0, 13, [(burger, 1), (frites, 1), (cola, 1)], status="nouvelle", note="Sans oignons svp, allergie aux arachides")
make(0, 13, [(burger, 2)], status="confirmee")
make(0, 13, [(rings, 1), (shake, 1)], status="en_cuisine", otype="sur_place")
make(0, 14, [(bbq, 1)], status="prete")

# Mouvements de stock (historique)
apply_movement(burger, 30, StockMovement.RESTOCK, user=marie, note="Livraison boucher")
apply_movement(burger, -6, StockMovement.SALE, user=None)
apply_movement(tira, -2, StockMovement.WASTE, user=marie, note="Invendus du soir")
apply_movement(bbq, 0, StockMovement.INVENTORY, user=marie, set_qty=3, note="Comptage")
print("Seed OK :", Order.objects.count(), "commandes,", MenuItem.objects.count(), "plats")

# ── Ingrédients, fournisseurs et recettes ─────────────────────────────────────
from apps.menus.models import Ingredient, Supplier, RecipeLine, IngredientMovement
from apps.menus.stock import apply_ingredient_movement, refresh_item_cost, sync_availability
boucher = Supplier.objects.create(restaurant=resto, name="Boucherie Dupont", contact_name="Luc", phone="+32 2 555 11 22", email="commandes@boucherie-dupont.be", note="Livraison mardi et vendredi")
metro   = Supplier.objects.create(restaurant=resto, name="Metro", phone="+32 2 555 33 44", note="Minimum 50 €")
def ing(name, unit, stock, thr, cost, sup=None, reorder=None):
    return Ingredient.objects.create(restaurant=resto, name=name, unit=unit, stock_qty=Decimal(stock), low_stock_threshold=Decimal(thr),
                                     unit_cost=Decimal(cost), supplier=sup, reorder_qty=Decimal(reorder) if reorder else None)
pain    = ing("Pain burger", "pc", 40, 15, "0.40", metro, 60)
steak   = ing("Steak haché", "kg", "1.8", "1.5", "12.00", boucher, 5)
cheddar = ing("Cheddar", "pc", 8, 20, "0.25", metro)
poulet  = ing("Filet de poulet", "kg", 0, "1", "9.50", boucher, 4)
sauce   = ing("Sauce BBQ", "l", "0.9", "0.5", "6.00", metro)
for it, lines in [(burger, [(pain, "1"), (steak, "0.15"), (cheddar, "1")]),
                  (bbq,    [(pain, "1"), (steak, "0.18"), (sauce, "0.03")]),
                  (chicken,[(pain, "1"), (poulet, "0.16")])]:
    for i, q in lines:
        RecipeLine.objects.create(item=it, ingredient=i, qty=Decimal(q))
    refresh_item_cost(it); sync_availability(it)
apply_ingredient_movement(steak, 5, IngredientMovement.RESTOCK, user=marie, note="Livraison boucher", sync=False)
apply_ingredient_movement(steak, -3.2, IngredientMovement.SALE, user=None, sync=False)
apply_ingredient_movement(pain, 0, IngredientMovement.INVENTORY, user=marie, set_qty=40, note="Comptage du matin", sync=False)
print("Ingrédients :", Ingredient.objects.count(), "| Burger portions =", MenuItem.objects.get(pk=burger.pk).portions_available)

# ── Équipe (codes PIN) ────────────────────────────────────────────────────────
from apps.restaurants.models import Employee
def emp(name, role, pin):
    e = Employee(restaurant=resto, name=name, role=role); e.set_pin(pin); e.save(); return e
sarah = emp("Sarah", Employee.CASHIER, "4826")
marco = emp("Marco", Employee.MANAGER, "7391")
for o in Order.objects.filter(restaurant=resto, order_type="comptoir").order_by("created_at")[:6]:
    o.employee = sarah if o.total_price < 15 else marco; o.save(update_fields=["employee"])
print("Équipe :", Employee.objects.count(), "membres")

# ── Disponibilité programmée ──────────────────────────────────────────────────
from datetime import time as _t
formule = item("Plats", "Formule midi", "12.90", "4.20", None, 5, "Plat du moment + boisson, du lundi au vendredi le midi")
formule.available_days = [0, 1, 2, 3, 4]; formule.available_from = _t(11, 30); formule.available_until = _t(14, 0); formule.save()
pdj = item("Plats", "Plat du jour : Lasagnes", "11.50", "3.60", 12, 3, "Lasagnes maison, salade")
pdj.available_on = now.date(); pdj.save()
brunch = item("Entrées", "Brunch du dimanche", "16.00", "5.00", None, 5, "Uniquement le dimanche jusqu'à 14h")
brunch.available_days = [6]; brunch.available_until = _t(14, 0); brunch.save()
print("Plats programmés :", MenuItem.objects.exclude(available_days=[]).count() + MenuItem.objects.filter(available_on__isnull=False).count())

# ── Avis, réponses, allergènes, favoris ───────────────────────────────────────
from apps.restaurants.models import Favorite
burger.allergens = "gluten, lactose, sésame"; burger.save(update_fields=["allergens"])
tira.allergens = "œufs, lactose, gluten"; tira.save(update_fields=["allergens"])
done = list(Order.objects.filter(restaurant=resto, client=jean, status="recuperee").order_by("created_at"))
for o, (rating, comment) in zip(done[:4], [(5, "Excellent burger, service rapide !"), (4, "Très bon, un peu d'attente."), (3, ""), (5, "Le tiramisu est une tuerie.")]):
    o.client_rating = rating; o.client_comment = comment; o.rated_at = o.created_at; o.save(update_fields=["client_rating", "client_comment", "rated_at"])
done[0].owner_reply = "Merci Jean, à très vite chez Burger House !"; done[0].owner_reply_at = now; done[0].save(update_fields=["owner_reply", "owner_reply_at"])
resto.avg_rating = 4.25; resto.save(update_fields=["avg_rating"])
Favorite.objects.get_or_create(user=jean, restaurant=resto)
print("Avis :", Order.objects.filter(client_rating__isnull=False).count())

# ── Fidélité et codes promo ───────────────────────────────────────────────────
from apps.orders.models import PromoCode
resto.loyalty_enabled = True; resto.loyalty_target = 5; resto.loyalty_reward_type = "percent"; resto.loyalty_reward_value = Decimal("15")
resto.save(update_fields=["loyalty_enabled", "loyalty_target", "loyalty_reward_type", "loyalty_reward_value"])
PromoCode.objects.create(restaurant=resto, code="BIENVENUE10", kind="percent", value=Decimal("10"), max_uses=100, uses=12)
PromoCode.objects.create(restaurant=resto, code="MIDI5", kind="amount", value=Decimal("5"), min_order=Decimal("20"), ends_at=now.date() + timedelta(days=30))
print("Codes promo :", PromoCode.objects.count())

# ── Livraison ─────────────────────────────────────────────────────────────────
resto.allow_delivery = True; resto.delivery_fee = Decimal("2.50"); resto.delivery_min_order = Decimal("15")
resto.delivery_days = [0, 1, 2, 3, 4]; resto.delivery_from = _t(11, 30); resto.delivery_until = _t(21, 30)
resto.delivery_info = "Bruxelles centre, 30 à 45 min"; resto.save()
print("Livraison activée")
resto.delivery_fee_mode = "zones"; resto.delivery_free_above = Decimal("40")
resto.delivery_zones = [{"label": "Centre", "postcodes": ["1000", "1050"], "fee": "2.50"}, {"label": "Périphérie", "postcodes": ["1800", "1830"], "fee": "5.00"}]
resto.delivery_days = []; resto.delivery_from = None; resto.delivery_until = None; resto.save()
liv = make(0, 14, [(burger, 2), (cola, 2)], status="prete", otype="livraison")
liv.delivery_address = "Rue Neuve 12, 1000 Bruxelles"; liv.delivery_postcode = "1000"; liv.delivery_fee = Decimal("2.50"); liv.total_price += Decimal("2.50"); liv.save()
print("Livraison en zones + commande à livrer")

# ── Photos de plats (fichiers locaux générés) ────────────────────────────────
from io import BytesIO
from PIL import Image, ImageDraw
from django.core.files.base import ContentFile
from apps.menus.models import MenuItemPhoto
def _jpg(color, label):
    im = Image.new("RGB", (640, 480), color); d = ImageDraw.Draw(im); d.text((24, 24), label, fill=(255, 255, 255)); b = BytesIO(); im.save(b, "JPEG", quality=80); return ContentFile(b.getvalue())
for it, colors in [(burger, [(232, 96, 40), (60, 140, 90), (70, 90, 200)]), (bbq, [(120, 60, 30), (200, 120, 40)]), (tira, [(160, 110, 80)])]:
    it.image.save("cover.jpg", _jpg(colors[0], f"{it.name} — photo 1"), save=True)
    for k, c in enumerate(colors[1:], start=2):
        ph = MenuItemPhoto(item=it, order=k); ph.image.save(f"p{k}.jpg", _jpg(c, f"{it.name} — photo {k}"), save=True)
print("Photos :", MenuItemPhoto.objects.count(), "supplémentaires")

# ── Photos du lieu ────────────────────────────────────────────────────────────
from apps.restaurants.models import RestaurantPhoto
for k, (c, cap) in enumerate([((90, 60, 40), "Façade"), ((40, 90, 120), "Salle principale"), ((60, 120, 70), "Terrasse")]):
    ph = RestaurantPhoto(restaurant=resto, caption=cap, order=k); ph.image.save(f"lieu{k}.jpg", _jpg(c, cap), save=True)
    if k == 0: resto.banner = ph.image.name; resto.save(update_fields=["banner"])
print("Photos du lieu :", RestaurantPhoto.objects.count())
