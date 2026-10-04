"""orders/urls.py"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import OrderViewSet, DailyClosureViewSet, PromoCodeViewSet

router = DefaultRouter()
# « closures » doit être enregistré avant le préfixe vide, sinon /closures/ serait lu comme un id de commande
router.register(r"closures", DailyClosureViewSet, basename="closure")
router.register(r"promos",   PromoCodeViewSet,    basename="promo")
router.register(r"",         OrderViewSet,        basename="order")

urlpatterns = [path("", include(router.urls))]
