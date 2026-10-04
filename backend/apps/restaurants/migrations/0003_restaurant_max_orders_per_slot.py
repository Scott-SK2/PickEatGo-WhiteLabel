from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("restaurants", "0002_restaurant_emoji"),
    ]

    operations = [
        migrations.AddField(
            model_name="restaurant",
            name="max_orders_per_slot",
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                help_text="Nb max de commandes par créneau (null = illimité)",
            ),
        ),
    ]
