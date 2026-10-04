"""
conftest.py — Fixtures pytest partagées pour tous les tests.

La suite s'exécute dans les deux modes de l'application :
  - `pytest`                              → mode « platform » (comportement historique) ;
  - `PICKEATGO_TEST_MODE=single pytest`   → mode « single » : l'instance est liée au restaurant
    de la fixture `restaurant` (TENANT_RESTAURANT_ID), comme une instance marque blanche.
Les tests propres à la place de marché portent le marqueur `platform_only` et sont ignorés en mode single ;
ceux propres au mode mono-restaurant forcent eux-mêmes le mode (fixture `single_mode`).
"""
import os

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from apps.accounts.models import User
from apps.restaurants.models import Restaurant

TEST_MODE = os.environ.get("PICKEATGO_TEST_MODE", "platform").strip().lower()


def pytest_configure(config):
    config.addinivalue_line("markers", "platform_only: test du comportement propre au mode plateforme (ignoré en mode single)")
    config.addinivalue_line("markers", "single_only: test du comportement propre au mode mono-restaurant")


@pytest.fixture(autouse=True)
def _test_mode(request, settings):
    """Applique le mode de la suite ; vide le cache (la marque y est conservée 60 s)."""
    cache.clear()
    if TEST_MODE == "single":
        if "platform_only" in request.keywords:
            pytest.skip("comportement propre au mode plateforme")
        settings.APP_MODE = "single"
        if "restaurant" in request.fixturenames:
            settings.TENANT_RESTAURANT_ID = str(request.getfixturevalue("restaurant").id)
        else:
            settings.TENANT_RESTAURANT_ID = None
    else:
        settings.APP_MODE = "platform"
        settings.TENANT_RESTAURANT_ID = None
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def client_user(db):
    return User.objects.create_user(
        email="client@test.com", password="pass1234",
        first_name="Jean", last_name="Dupont", role=User.CLIENT
    )


@pytest.fixture
def restaurateur_user(db):
    return User.objects.create_user(
        email="resto@test.com", password="pass1234",
        first_name="Marco", last_name="Rossi", role=User.RESTAURATEUR
    )


@pytest.fixture
def admin_user(db):
    return User.objects.create_superuser(
        email="admin@test.com", password="pass1234",
        first_name="Admin", last_name="PickEatGo"
    )


@pytest.fixture
def restaurant(db, restaurateur_user):
    return Restaurant.objects.create(
        owner=restaurateur_user,
        name="Test Burger",
        cuisine="Américain",
        address="1 Rue Test, Bruxelles",
        phone="+32 2 000 00 00",
        status=Restaurant.ACTIVE,
        is_open=True,
    )


@pytest.fixture
def single_mode(settings, restaurant):
    """Force le mode mono-restaurant lié à la fixture `restaurant` (quel que soit le mode de la suite)."""
    settings.APP_MODE = "single"
    settings.TENANT_RESTAURANT_ID = str(restaurant.id)
    settings.POWERED_BY_BADGE = True
    cache.clear()
    return restaurant
