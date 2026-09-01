#!/usr/bin/env python3
"""
Regression tests for /connect-info token disclosure (production hardening)
and the configurable TOKEN_FILE persistent path.

Root cause under test: /connect-info is intentionally unauthenticated (the
mobile app uses it to auto-fill onboarding), so it must never return the
Access Token when ENVIRONMENT=production.
"""

import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure backend root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import api as api_module  # noqa: E402
from api import app, API_TOKEN  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def _restore_api_state():
    """Some tests reload the `api` module under a different ENVIRONMENT /
    TOKEN_FILE to exercise import-time behavior. Restore the real env vars
    and reload back to the original state afterwards so other tests (in
    this file or others) see consistent module state."""
    original_token_file = os.environ.get("TOKEN_FILE")
    original_environment = os.environ.get("ENVIRONMENT")
    yield
    if original_token_file is None:
        os.environ.pop("TOKEN_FILE", None)
    else:
        os.environ["TOKEN_FILE"] = original_token_file
    if original_environment is None:
        os.environ.pop("ENVIRONMENT", None)
    else:
        os.environ["ENVIRONMENT"] = original_environment
    importlib.reload(api_module)


def test_connect_info_includes_token_outside_production(monkeypatch):
    """Default/dev/local onboarding behavior is preserved."""
    monkeypatch.setattr(api_module, "IS_PRODUCTION", False)

    response = client.get("/connect-info")

    assert response.status_code == 200
    assert response.json()["token"] == API_TOKEN


def test_connect_info_never_discloses_token_in_production(monkeypatch):
    """The security requirement under test: an unauthenticated GET to
    /connect-info in production must never return the Access Token."""
    monkeypatch.setattr(api_module, "IS_PRODUCTION", True)

    response = client.get("/connect-info")

    assert response.status_code == 200
    body = response.json()
    assert "token" not in body
    # Sanity: the rest of the onboarding payload is still present.
    assert body["name"] == "SuperBrain"
    assert "url" in body


def test_connect_info_production_hides_token_even_with_valid_api_key(monkeypatch):
    """/connect-info takes no auth dependency at all; confirm production
    hides the token even when the caller happens to supply a valid key,
    since the route itself — not an auth check — must gate disclosure."""
    monkeypatch.setattr(api_module, "IS_PRODUCTION", True)

    response = client.get("/connect-info", headers={"X-API-Key": API_TOKEN})

    assert response.status_code == 200
    assert "token" not in response.json()


def test_token_file_env_var_controls_persistent_path(monkeypatch, tmp_path):
    """TOKEN_FILE env var must be honored for the persistent token path
    (e.g. Coolify setting TOKEN_FILE=/app/data/token.txt)."""
    custom_path = tmp_path / "persisted-token.txt"
    monkeypatch.setenv("TOKEN_FILE", str(custom_path))
    monkeypatch.delenv("ENVIRONMENT", raising=False)

    reloaded = importlib.reload(api_module)

    assert reloaded.TOKEN_FILE == custom_path
    assert custom_path.exists()

    saved_token = custom_path.read_text(encoding="utf-8").strip()
    assert saved_token == reloaded.API_TOKEN
    assert len(saved_token) == 8
    assert saved_token.isalnum()


def test_token_file_default_preserves_previous_location(monkeypatch):
    """With TOKEN_FILE unset, the token path is unchanged from before:
    backend/token.txt next to api.py."""
    monkeypatch.delenv("TOKEN_FILE", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)

    reloaded = importlib.reload(api_module)

    expected = Path(reloaded.__file__).resolve().parent / "token.txt"
    assert reloaded.TOKEN_FILE == expected


def test_token_still_8_char_alphanumeric_with_custom_token_file(monkeypatch, tmp_path):
    """8-char token/app compatibility must hold regardless of TOKEN_FILE."""
    custom_path = tmp_path / "token.txt"
    monkeypatch.setenv("TOKEN_FILE", str(custom_path))

    reloaded = importlib.reload(api_module)

    assert len(reloaded.API_TOKEN) == 8
    assert reloaded.API_TOKEN.isalnum()
    assert reloaded.is_valid_api_token_format(reloaded.API_TOKEN)


if __name__ == '__main__':
    print('Running /connect-info security regression tests (pytest required)...')
    raise SystemExit(pytest.main([__file__, '-v']))
