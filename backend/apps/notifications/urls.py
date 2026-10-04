"""notifications/urls.py"""
from django.urls import path
from .views import vapid_key, subscription, test_push

urlpatterns = [
    path("push/key/",          vapid_key,    name="push-key"),
    path("push/subscription/", subscription, name="push-subscription"),
    path("push/test/",         test_push,    name="push-test"),
]
