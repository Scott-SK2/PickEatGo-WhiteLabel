"""restaurants/urls.py"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import RestaurantViewSet, ReportViewSet, EmployeeViewSet

router = DefaultRouter()
router.register(r"reports",   ReportViewSet,   basename="report")
router.register(r"employees", EmployeeViewSet, basename="employee")
router.register(r"", RestaurantViewSet, basename="restaurant")

urlpatterns = [path("", include(router.urls))]
