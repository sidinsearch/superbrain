"""
SuperBrain API Token Manager
Manage your API authentication token
"""
import sys
import os
from pathlib import Path
import secrets
import string

TOKEN_FILE = Path(__file__).parent.parent / "token.txt"

def generate_token(length=8):
    """Generate an 8-character alphanumeric Access Token"""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def is_valid_token(token: str) -> bool:
    """Validate token format: exactly 8 alphanumeric characters."""
    return len(token) == 8 and token.isalnum()

def load_token():
    """Load existing token"""
    if TOKEN_FILE.exists():
        with open(TOKEN_FILE, 'r') as f:
            return f.read().strip()
    return None

def save_token(token):
    """Save token to file"""
    with open(TOKEN_FILE, 'w') as f:
        f.write(token)
    print(f"\n✅ Token saved to: {TOKEN_FILE}")

def main():
    print("\n" + "="*80)
    print("🔐 SuperBrain Access Token Manager")
    print("="*80)
    
    current_token = load_token()
    
    if current_token:
        print(f"\n📋 Current Token: {current_token}")
    else:
        print("\n⚠️  No token found!")
    
    print("\nOptions:")
    print("  1. Generate new random token")
    print("  2. Set custom token")
    print("  3. View current token")
    print("  4. Exit")
    
    choice = input("\nEnter choice (1-4): ").strip()
    
    if choice == "1":
        new_token = generate_token()
        save_token(new_token)
        print(f"\n🔑 New Token: {new_token}")
        print("\n💡 Use this in API requests:")
        print(f"   Header: X-API-Key: {new_token}")
        print("\n⚠️  Restart the API server for changes to take effect!")
        
    elif choice == "2":
        custom_token = input("\nEnter custom 8-character token: ").strip().upper()
        if not is_valid_token(custom_token):
            print("\n❌ Invalid token! Use exactly 8 alphanumeric characters.")
            return
        save_token(custom_token)
        print(f"\n🔑 Token set to: {custom_token}")
        print("\n⚠️  Restart the API server for changes to take effect!")
        
    elif choice == "3":
        if current_token:
            print(f"\n🔑 Current Token: {current_token}")
            print("\n💡 Use in API requests:")
            print(f"   Header: X-API-Key: {current_token}")
        else:
            print("\n⚠️  No token found!")
            
    elif choice == "4":
        print("\n👋 Goodbye!")
        return
        
    else:
        print("\n❌ Invalid choice!")
    
    print("\n" + "="*80 + "\n")

if __name__ == "__main__":
    main()
