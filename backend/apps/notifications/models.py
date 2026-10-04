"""notifications/models.py — abonnements Web Push (un par navigateur / appareil)."""
from django.conf import settings
from django.db import models


class PushSubscription(models.Model):
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint   = models.URLField(max_length=1000, unique=True)
    p256dh     = models.CharField(max_length=255)
    auth       = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used  = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "push_subscriptions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} — {self.endpoint[:40]}…"

    @property
    def info(self):
        return {"endpoint": self.endpoint, "keys": {"p256dh": self.p256dh, "auth": self.auth}}
