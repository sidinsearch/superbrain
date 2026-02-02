#!/usr/bin/env python3
import requests
import json

# Read token
with open('token.txt', 'r') as f:
    token = f.read().strip()

# Test the /recent endpoint
response = requests.get(
    'http://localhost:5000/recent?limit=10',
    headers={'X-API-Key': token}
)

print(f"Status Code: {response.status_code}")
print(f"\nResponse:")
print(json.dumps(response.json(), indent=2))
