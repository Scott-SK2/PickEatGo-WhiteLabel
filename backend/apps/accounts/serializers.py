"""accounts/serializers.py"""
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    password  = serializers.CharField(write_only=True, min_length=8)
    password2 = serializers.CharField(write_only=True)

    class Meta:
        model  = User
        fields = ["email","first_name","last_name","phone","phone_visible","role","password","password2"]
        extra_kwargs = {
            "role":          {"default": User.CLIENT},
            "phone":         {"required": True},
            "phone_visible": {"required": False, "default": True},
        }

    def validate_role(self, value):
        """Seuls client et restaurateur peuvent s'inscrire ; l'administration est attribuée en base."""
        if value not in (User.CLIENT, User.RESTAURATEUR):
            raise serializers.ValidationError("Rôle non autorisé à l'inscription.")
        from apps.tenant.context import is_single_mode
        if value == User.RESTAURATEUR and is_single_mode():
            raise serializers.ValidationError("Cette application n'accepte que des comptes clients.")
        return value

    def validate(self, data):
        if data["password"] != data.pop("password2"):
            raise serializers.ValidationError({"password2": "Les mots de passe ne correspondent pas."})
        return data

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.ReadOnlyField()

    class Meta:
        model  = User
        fields = ["id","email","first_name","last_name","full_name","phone","phone_visible",
                  "role","avatar","is_active","is_verified","is_flagged","created_at"]
        read_only_fields = ["id","is_verified","is_flagged","created_at"]


class MeSerializer(UserSerializer):
    """Profil de l'utilisateur connecté : rôle, état du compte et e-mail ne se modifient pas soi-même."""
    class Meta(UserSerializer.Meta):
        read_only_fields = UserSerializer.Meta.read_only_fields + ["role", "is_active", "email"]


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"]      = user.role
        token["full_name"] = user.full_name
        token["email"]     = user.email
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
