from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView


def health(_request):
    """Réveil / supervision : répond sans toucher à la base."""
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health/",        health),
    path("api/v1/auth/",          include("apps.accounts.urls")),
    path("api/v1/restaurants/",   include("apps.restaurants.urls")),
    path("api/v1/menus/",         include("apps.menus.urls")),
    path("api/v1/orders/",        include("apps.orders.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    path("api/v1/branding/",      include("apps.tenant.urls")),       # marque blanche : mode, restaurant lié, marque

    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/",   SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

# Développement sans Cloudinary : sert les images téléversées localement
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
