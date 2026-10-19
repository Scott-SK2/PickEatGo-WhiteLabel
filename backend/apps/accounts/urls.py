"""accounts/urls.py"""
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (RegisterView, LoginView, MeView, LogoutView, UserListView, UserDetailView,
                    ChangePasswordView, PasswordResetRequestView, PasswordResetConfirmView, AdminResetPasswordView)

urlpatterns = [
    path("register/",   RegisterView.as_view(),    name="auth-register"),
    path("login/",      LoginView.as_view(),        name="auth-login"),
    path("logout/",     LogoutView.as_view(),       name="auth-logout"),
    path("refresh/",    TokenRefreshView.as_view(), name="auth-refresh"),
    path("me/",         MeView.as_view(),           name="auth-me"),
    path("change-password/",        ChangePasswordView.as_view(),        name="auth-change-password"),
    path("password-reset/",         PasswordResetRequestView.as_view(),  name="auth-password-reset"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(),  name="auth-password-reset-confirm"),
    path("users/",      UserListView.as_view(),     name="auth-users"),
    path("users/<uuid:pk>/", UserDetailView.as_view(), name="auth-user-detail"),
    path("users/<uuid:pk>/reset-password/", AdminResetPasswordView.as_view(), name="auth-user-reset-password"),
]
