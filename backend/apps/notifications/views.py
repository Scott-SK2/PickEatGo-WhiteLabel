"""notifications/views.py — abonnement Web Push."""
from django.conf import settings
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import PushSubscription
from .push import push_enabled, send_push


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def vapid_key(request):
    """GET /api/v1/notifications/push/key/ — clé publique VAPID (vide si le push n'est pas configuré)."""
    return Response({"enabled": push_enabled(), "public_key": getattr(settings, "VAPID_PUBLIC_KEY", "") if push_enabled() else ""})


@api_view(["GET", "POST", "DELETE"])
@permission_classes([permissions.IsAuthenticated])
def subscription(request):
    """
    GET    /notifications/push/subscription/?endpoint=…  → {"subscribed": bool}
    POST   /notifications/push/subscription/  {"endpoint", "keys": {"p256dh", "auth"}}
    DELETE /notifications/push/subscription/  {"endpoint"}
    """
    if request.method == "GET":
        ep = request.query_params.get("endpoint", "")
        return Response({"subscribed": bool(ep) and PushSubscription.objects.filter(user=request.user, endpoint=ep).exists(),
                         "devices": PushSubscription.objects.filter(user=request.user).count()})
    data = request.data.get("subscription", request.data) or {}
    endpoint = str(data.get("endpoint", "")).strip()
    if not endpoint.startswith("https://"):
        return Response({"detail": "Abonnement invalide."}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == "DELETE":
        PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({"subscribed": False})
    keys = data.get("keys") or {}
    if not keys.get("p256dh") or not keys.get("auth"):
        return Response({"detail": "Clés d'abonnement manquantes."}, status=status.HTTP_400_BAD_REQUEST)
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={"user": request.user, "p256dh": keys["p256dh"], "auth": keys["auth"],
                  "user_agent": request.META.get("HTTP_USER_AGENT", "")[:255]},
    )
    return Response({"subscribed": True}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def test_push(request):
    """POST /notifications/push/test/ — envoie une notification de test à l'utilisateur connecté."""
    from apps.tenant.brand import brand_context
    n = send_push(request.user, f"{brand_context()['app_name']} 👋", "Les notifications fonctionnent sur cet appareil.", url="/", tag="test", sync=True)
    if not push_enabled():
        return Response({"detail": "Les notifications push ne sont pas configurées sur le serveur."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"sent": n})
