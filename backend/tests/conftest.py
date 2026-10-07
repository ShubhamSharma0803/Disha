"""Pytest configuration and fixtures for Disha backend tests."""
import os
import pytest

os.environ["HOP_DELAY_S"] = "0"


@pytest.fixture(autouse=True)
def ensure_default_test_env():
    """Ensure HOP_DELAY_S defaults to 0 for tests unless temporarily overridden."""
    orig = os.environ.get("HOP_DELAY_S", "0")
    yield
    os.environ["HOP_DELAY_S"] = orig
