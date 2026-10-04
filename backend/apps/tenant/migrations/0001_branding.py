import apps.tenant.models
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("restaurants", "0012_restaurant_gallery"),
    ]

    operations = [
        migrations.CreateModel(
            name="Branding",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("app_name", models.CharField(help_text="Nom affiché partout : barre du haut, onglet, installation, e-mails, tickets", max_length=40)),
                ("short_name", models.CharField(help_text="Nom sous l'icône de l'écran d'accueil", max_length=12)),
                ("tagline", models.CharField(blank=True, help_text="Phrase d'accroche de l'accueil", max_length=120)),
                ("welcome_text", models.CharField(blank=True, help_text="Paragraphe sous le slogan", max_length=300)),
                ("icon_192", models.ImageField(blank=True, null=True, upload_to=apps.tenant.models.branding_upload_path)),
                ("icon_512", models.ImageField(blank=True, null=True, upload_to=apps.tenant.models.branding_upload_path)),
                ("icon_maskable", models.ImageField(blank=True, null=True, upload_to=apps.tenant.models.branding_upload_path)),
                ("share_image", models.ImageField(blank=True, help_text="1200 × 630 px conseillé", null=True, upload_to=apps.tenant.models.branding_upload_path)),
                ("theme_color", models.CharField(default="#FF6B2C", max_length=7)),
                ("social_links", models.JSONField(blank=True, default=dict)),
                ("legal_name", models.CharField(blank=True, help_text="Raison sociale", max_length=120)),
                ("company_number", models.CharField(blank=True, help_text="Numéro d'entreprise", max_length=40)),
                ("vat_number", models.CharField(blank=True, max_length=30)),
                ("legal_address", models.CharField(blank=True, help_text="Adresse du siège", max_length=255)),
                ("publisher", models.CharField(blank=True, help_text="Responsable de publication", max_length=120)),
                ("terms_text", models.TextField(blank=True, help_text="Conditions de commande")),
                ("privacy_text", models.TextField(blank=True, help_text="Politique de confidentialité")),
                ("sender_name", models.CharField(blank=True, max_length=60)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("restaurant", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="branding", to="restaurants.restaurant")),
            ],
            options={
                "verbose_name": "Marque de l'application",
                "db_table": "branding",
            },
        ),
    ]
