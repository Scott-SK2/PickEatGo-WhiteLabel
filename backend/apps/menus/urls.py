"""menus/urls.py"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (CategoryViewSet, MenuItemViewSet, StockMovementViewSet,
                    SupplierViewSet, IngredientViewSet, IngredientMovementViewSet)

router = DefaultRouter()
router.register(r"categories",           CategoryViewSet,            basename="category")
router.register(r"items",                MenuItemViewSet,            basename="menuitem")
router.register(r"stock-movements",      StockMovementViewSet,       basename="stockmovement")
router.register(r"suppliers",            SupplierViewSet,            basename="supplier")
router.register(r"ingredients",          IngredientViewSet,          basename="ingredient")
router.register(r"ingredient-movements", IngredientMovementViewSet,  basename="ingredientmovement")

urlpatterns = [path("", include(router.urls))]
