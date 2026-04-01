#!/usr/bin/env python3
"""
Legacy filename retained for compatibility.
This script now validates API key authentication behavior.
"""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

# Ensure backend root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import app, API_TOKEN, generate_api_token  # noqa: E402


client = TestClient(app)


def test_generate_api_token_shape():
    token = generate_api_token()
    assert isinstance(token, str)
    assert len(token) == 8
    assert token.isalnum()


def test_ping_works_without_auth():
    response = client.get('/ping')
    assert response.status_code == 200


def test_queue_status_rejects_invalid_api_key():
    response = client.get('/queue-status', headers={'X-API-Key': 'INVALID_TOKEN'})
    assert response.status_code == 401


def test_queue_status_accepts_valid_api_key():
    response = client.get('/queue-status', headers={'X-API-Key': API_TOKEN})
    assert response.status_code == 200


def test_connect_endpoint_is_deprecated():
    response = client.post('/connect', json={'api_key': API_TOKEN})
    assert response.status_code == 410


if __name__ == '__main__':
    print('Running API key auth tests...')
    test_generate_api_token_shape()
    print('PASS: API token generation shape')

    test_ping_works_without_auth()
    print('PASS: /ping unauthenticated access')

    test_queue_status_rejects_invalid_api_key()
    print('PASS: /queue-status rejects invalid API key')

    test_queue_status_accepts_valid_api_key()
    print('PASS: /queue-status accepts valid API key')

    test_connect_endpoint_is_deprecated()
    print('PASS: /connect deprecated behavior')

    print('\nAll API key auth tests passed!')
