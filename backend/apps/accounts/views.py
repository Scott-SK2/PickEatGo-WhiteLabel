"""accounts/views.py"""
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from .models import User
from .serializers import RegisterSerializer, UserSerializer, CustomTokenObtainPairSerializer, MeSerializer


class RegisterView(generics.CreateAPIView):
    """POST /api/v1/auth/register/"""
    serializer_class   = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        # Génère tokens directement après inscription
        refresh = RefreshToken.for_user(user)
        return Response({
            "user":    UserSerializer(user).data,
            "access":  str(refresh.access_token),
            "refresh": str(refresh),
        }, status=status.HTTP_201_CREATED)


class LoginView(TokenObtainPairView):
    """POST /api/v1/auth/login/"""
    serializer_class = CustomTokenObtainPairSerializer


class MeView(generics.RetrieveUpdateAPIView):
    """GET|PATCH /api/v1/auth/me/"""
    serializer_class   = MeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class LogoutView(APIView):
    """POST /api/v1/auth/logout/ — blacklist le refresh token"""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            token = RefreshToken(request.data["refresh"])
            token.blacklist()
            return Response({"detail": "Déconnexion réussie."})
        except Exception:
            return Response({"detail": "Token invalide."}, status=status.HTTP_400_BAD_REQUEST)


class UserListView(generics.ListAPIView):
    """GET /api/v1/auth/users/ — Admin : liste tous les utilisateurs"""
    serializer_class   = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if not self.request.user.is_admin_user:
            return User.objects.none()
        return User.objects.all().order_by("-created_at")


class UserDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET|PATCH|DELETE /api/v1/auth/users/{id}/ — Admin"""
    serializer_class   = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset           = User.objects.all()

    def get_object(self):
        if not self.request.user.is_admin_user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Accès réservé aux admins.")
        return super().get_object()

    def partial_update(self, request, *args, **kwargs):
        """PATCH — permet de bloquer/débloquer via is_active"""
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)


# ── Mot de passe ───────────────────────────────────────────────────────────────
from rest_framework.throttling import ScopedRateThrottle
import secrets
from django.shortcuts import get_object_or_404

TEMP_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # sans 0/O, 1/l/I


def generate_temporary_password():
    """12 caractères lisibles, groupés par 4 (ex. « Kf7r-Tq2m-Wp9x ») : facile à dicter, assez fort pour un usage unique."""
    chars = "".join(secrets.choice(TEMP_PASSWORD_ALPHABET) for _ in range(12))
    return "-".join(chars[i:i + 4] for i in range(0, 12, 4))


def revoke_refresh_tokens(user):
    """Ferme les sessions ouvertes : tous les jetons de rafraîchissement connus de l'utilisateur sont révoqués."""
    try:
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)
    except Exception:
        pass


class AdminResetPasswordView(APIView):
    """
    POST /api/v1/auth/users/{id}/reset-password/ — Éditeur (admin) uniquement.
    Génère un mot de passe temporaire, le pose sur le compte et le renvoie UNE SEULE FOIS (il n'est pas conservé
    en clair). Les sessions ouvertes de l'utilisateur sont fermées. Sert quand l'instance n'a pas de SMTP
    (pas de « mot de passe oublié ») ou à la remise des accès au restaurateur.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        if not request.user.is_admin_user:
            return Response({"detail": "Accès réservé aux admins."}, status=status.HTTP_403_FORBIDDEN)
        user = get_object_or_404(User, pk=pk)
        temporary = generate_temporary_password()
        user.set_password(temporary)
        user.save(update_fields=["password"])
        revoke_refresh_tokens(user)
        return Response({"email": user.email, "temporary_password": temporary,
                         "detail": "Mot de passe temporaire généré. Il ne sera plus affiché : transmettez-le à l'utilisateur, qui le changera dans « Mon profil »."})
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.conf import settings


class ChangePasswordView(APIView):
    """POST /api/v1/auth/change-password/ {"old_password", "new_password"}"""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        old, new = str(request.data.get("old_password", "")), str(request.data.get("new_password", ""))
        if not request.user.check_password(old):
            return Response({"detail": "Mot de passe actuel incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        if len(new) < 8:
            return Response({"detail": "Le nouveau mot de passe doit contenir au moins 8 caractères."}, status=status.HTTP_400_BAD_REQUEST)
        request.user.set_password(new)
        request.user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe modifié."})


class PasswordResetRequestView(APIView):
    """POST /api/v1/auth/password-reset/ {"email"} — envoie un lien (réponse identique que l'e-mail existe ou non)."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        email = str(request.data.get("email", "")).strip().lower()
        user = User.objects.filter(email__iexact=email, is_active=True).first() if email else None
        if user:
            from apps.notifications.emails import password_reset
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = f"{settings.FRONTEND_URL.rstrip('/')}/reset?uid={uid}&token={token}"
            password_reset(user, link)
        return Response({"detail": "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé."})


class PasswordResetConfirmView(APIView):
    """POST /api/v1/auth/password-reset/confirm/ {"uid", "token", "new_password"}"""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(str(request.data.get("uid", "")))))
        except Exception:
            user = None
        if user is None or not default_token_generator.check_token(user, str(request.data.get("token", ""))):
            return Response({"detail": "Lien invalide ou expiré. Refaites une demande."}, status=status.HTTP_400_BAD_REQUEST)
        new = str(request.data.get("new_password", ""))
        if len(new) < 8:
            return Response({"detail": "Le mot de passe doit contenir au moins 8 caractères."}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(new)
        user.save(update_fields=["password"])
        return Response({"detail": "Mot de passe réinitialisé. Vous pouvez vous connecter."})
