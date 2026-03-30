#!/usr/bin/env python3
"""
Test suite for sync code generation and validation.
Tests the alphanumeric sync code feature.
"""
import sys
import re
from pathlib import Path

# Ensure backend root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Import the functions to test
from api import create_sync_code, generate_api_token


class TestSyncCodeGeneration:
    """Test suite for sync code generation functions."""

    def test_generate_api_token_uses_alphanumeric(self):
        """Test that generate_api_token uses alphanumeric characters (letters + digits)."""
        token = generate_api_token(length=32)
        
        # Token should only contain alphanumeric characters
        assert token.isalnum(), f"Token contains non-alphanumeric characters: {token}"
        
    def test_generate_api_token_has_digits(self):
        """Test that generate_api_token actually includes digits."""
        # Generate multiple tokens to ensure we get at least one with digits
        tokens_with_digits = 0
        for _ in range(100):
            token = generate_api_token(length=32)
            if any(c.isdigit() for c in token):
                tokens_with_digits += 1
        
        # At least 90% of tokens should contain digits (allowing for randomness)
        assert tokens_with_digits >= 90, f"Only {tokens_with_digits}/100 tokens contain digits"
        
    def test_sync_code_is_alphanumeric(self):
        """Test that sync code is alphanumeric (contains both letters and digits)."""
        api_token, sync_code = create_sync_code()
        
        # Sync code should be alphanumeric
        assert sync_code.isalnum(), f"Sync code contains non-alphanumeric characters: {sync_code}"
        
    def test_sync_code_contains_digits(self):
        """Test that sync code actually contains digits."""
        # Generate multiple sync codes to ensure we get at least one with digits
        sync_codes_with_digits = 0
        for _ in range(100):
            _, sync_code = create_sync_code()
            if any(c.isdigit() for c in sync_code):
                sync_codes_with_digits += 1
        
        # At least 90% of sync codes should contain digits
        assert sync_codes_with_digits >= 90, f"Only {sync_codes_with_digits}/100 sync codes contain digits"
        
    def test_sync_code_length(self):
        """Test that sync code is 8 characters long."""
        _, sync_code = create_sync_code()
        
        assert len(sync_code) == 8, f"Sync code should be 8 chars, got {len(sync_code)}: {sync_code}"
        
    def test_sync_code_is_uppercase(self):
        """Test that sync code is uppercase."""
        _, sync_code = create_sync_code()
        
        assert sync_code.isupper(), f"Sync code should be uppercase: {sync_code}"


class TestConnectEndpoint:
    """Test suite for the /connect endpoint."""
    
    def test_sync_code_validation_pattern(self):
        """Test that sync code validation accepts alphanumeric codes."""
        # This tests the pattern that should be accepted
        valid_codes = ['ABC123XY', 'TEST1234', '12345678', 'AAAAAAAA']
        
        for code in valid_codes:
            # Code should be alphanumeric
            assert code.isalnum(), f"Code should be alphanumeric: {code}"
            assert len(code) == 8, f"Code should be 8 chars: {code}"


class TestConnectEndpointIntegration:
    """Integration tests for the /connect endpoint."""
    
    def test_sync_code_in_status_endpoint(self):
        """Test that status endpoint returns the current sync code."""
        # Import here to avoid circular imports
        from api import app, SYNC_CODE
        from fastapi.testclient import TestClient
        
        client = TestClient(app)
        response = client.get("/status")
        
        assert response.status_code == 200
        data = response.json()
        assert "sync_code" in data
        # The sync code from file should be alphanumeric
        assert data["sync_code"].isalnum(), f"Sync code should be alphanumeric: {data['sync_code']}"
        
    def test_connect_with_valid_sync_code(self):
        """Test connecting with a valid sync code."""
        from api import app, SYNC_CODE
        from fastapi.testclient import TestClient
        
        client = TestClient(app)
        
        # Get the current sync code
        response = client.get("/status")
        current_sync_code = response.json()["sync_code"]
        
        # Try to connect with valid sync code
        response = client.post("/connect", json={"sync_code": current_sync_code})
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert "api_token" in data
        
    def test_connect_with_invalid_sync_code(self):
        """Test connecting with an invalid sync code."""
        from api import app
        from fastapi.testclient import TestClient
        
        client = TestClient(app)
        
        # Try to connect with invalid sync code
        response = client.post("/connect", json={"sync_code": "INVALID12"})
        
        assert response.status_code == 401
        assert "Invalid sync code" in response.json()["detail"]
        
    def test_connect_with_non_alphanumeric_sync_code(self):
        """Test connecting with non-alphanumeric sync code is rejected."""
        from api import app
        from fastapi.testclient import TestClient
        
        client = TestClient(app)
        
        # Try to connect with non-alphanumeric sync code (has special chars)
        response = client.post("/connect", json={"sync_code": "TEST-123"})
        
        # Should return 400 for invalid format
        assert response.status_code == 400
        assert "alphanumeric" in response.json()["detail"].lower()
        
    def test_connect_without_body(self):
        """Test connecting without a body returns proper error."""
        from api import app
        from fastapi.testclient import TestClient
        
        client = TestClient(app)
        
        # Try to connect without body
        response = client.post("/connect")
        
        # FastAPI should return 422 for missing required field
        assert response.status_code == 422


if __name__ == '__main__':
    # Run basic tests
    print("Running sync code generation tests...")
    
    # Test 1: Check if tokens are alphanumeric
    token = generate_api_token(length=32)
    print(f"Generated token: {token}")
    print(f"Token is alphanumeric: {token.isalnum()}")
    print(f"Token contains digits: {any(c.isdigit() for c in token)}")
    
    # Test 2: Check sync code
    api_token, sync_code = create_sync_code()
    print(f"\nGenerated API token: {api_token}")
    print(f"Generated sync code: {sync_code}")
    print(f"Sync code is alphanumeric: {sync_code.isalnum()}")
    print(f"Sync code contains digits: {any(c.isdigit() for c in sync_code)}")
    print(f"Sync code length: {len(sync_code)}")
    print(f"Sync code is uppercase: {sync_code.isupper()}")
    
    # Run multiple times to check randomness
    print("\n--- Generating 10 sync codes ---")
    for i in range(10):
        _, sync_code = create_sync_code()
        has_digit = any(c.isdigit() for c in sync_code)
        print(f"Sync code {i+1}: {sync_code} - Has digit: {has_digit}")
    
    # Run integration tests
    print("\n--- Running integration tests ---")
    import warnings
    warnings.filterwarnings("ignore")
    
    test = TestConnectEndpointIntegration()
    
    print("Test 1: Sync code in status endpoint...")
    test.test_sync_code_in_status_endpoint()
    print("PASSED")
    
    print("Test 2: Connect with valid sync code...")
    test.test_connect_with_valid_sync_code()
    print("PASSED")
    
    print("Test 3: Connect with invalid sync code...")
    test.test_connect_with_invalid_sync_code()
    print("PASSED")
    
    print("Test 4: Connect with non-alphanumeric sync code...")
    test.test_connect_with_non_alphanumeric_sync_code()
    print("PASSED")
    
    print("Test 5: Connect without body...")
    test.test_connect_without_body()
    print("PASSED")
    
    print("\nAll tests passed!")
