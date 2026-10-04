"""
Migration 0004 : convertit cuisine CharField → JSONField (liste de types de cuisine)
"""
from django.db import migrations, models


def cuisine_to_list(apps, schema_editor):
    Restaurant = apps.get_model("restaurants", "Restaurant")
    for r in Restaurant.objects.all():
        old = r.cuisine_str or ""
        r.cuisine = [old] if old else []
        r.save(update_fields=["cuisine"])


class Migration(migrations.Migration):

    dependencies = [
        ("restaurants", "0003_restaurant_max_orders_per_slot"),
    ]

    operations = [
        # 1. Sauvegarder l'ancienne valeur dans un champ temporaire
        migrations.RenameField("restaurant", "cuisine", "cuisine_str"),
        # 2. Ajouter le nouveau champ JSONField
        migrations.AddField(
            model_name="restaurant",
            name="cuisine",
            field=models.JSONField(default=list),
        ),
        # 3. Migrer les données (string → [string])
        migrations.RunPython(cuisine_to_list, migrations.RunPython.noop),
        # 4. Supprimer l'ancien champ
        migrations.RemoveField("restaurant", "cuisine_str"),
    ]
