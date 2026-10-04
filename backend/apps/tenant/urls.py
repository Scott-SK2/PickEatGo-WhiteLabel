"""tenant/urls.py"""
from django.urls import path

from .views import BrandingIconsView, BrandingView, InstanceInfoView

urlpatterns = [
    path("",          BrandingView.as_view(),      name="branding"),
    path("icons/",    BrandingIconsView.as_view(), name="branding-icons"),
    path("instance/", InstanceInfoView.as_view(),  name="branding-instance"),
]
