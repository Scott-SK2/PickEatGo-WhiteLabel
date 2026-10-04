"""
accounts/models.py
User personnalisé avec 3 rôles : CLIENT | RESTAURATEUR | ADMIN
"""
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from django.db import models
import uuid


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("L'email est obligatoire")
        email = self.normalize_email(email)
        user  = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("role", User.ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    CLIENT       = "client"
    RESTAURATEUR = "restaurateur"
    ADMIN        = "admin"
    ROLE_CHOICES = [
        (CLIENT,       "Client"),
        (RESTAURATEUR, "Restaurateur"),
        (ADMIN,        "Administrateur"),
    ]

    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email      = models.EmailField(unique=True)
    first_name = models.CharField(max_length=80)
    last_name  = models.CharField(max_length=80)
    phone      = models.CharField(max_length=20, blank=True)
    phone_visible = models.BooleanField(
        default=True,
        help_text="Si True, le restaurateur peut voir le numéro dans les commandes"
    )
    role       = models.CharField(max_length=20, choices=ROLE_CHOICES, default=CLIENT)
    avatar     = models.ImageField(upload_to="avatars/", blank=True, null=True)

    is_active   = models.BooleanField(default=True)
    is_staff    = models.BooleanField(default=False)
    is_verified = models.BooleanField(default=False)
    is_flagged  = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects         = UserManager()
    USERNAME_FIELD  = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        db_table   = "users"
        verbose_name = "Utilisateur"
        ordering   = ["-created_at"]

    def __str__(self):
        return f"{self.full_name} <{self.email}> [{self.role}]"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def is_client(self):
        return self.role == self.CLIENT

    @property
    def is_restaurateur(self):
        return self.role == self.RESTAURATEUR

    @property
    def is_admin_user(self):
        return self.role == self.ADMIN
