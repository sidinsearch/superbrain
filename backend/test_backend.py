"""
SuperBrain - Comprehensive Backend Test Suite
Tests all API endpoints against the running backend.
"""
import requests
import sys
import json
import time

# Config
BASE_URL = "http://localhost:5000"
TOKEN = "4XVTLWWV"
HEADERS = {"X-API-Key": TOKEN, "Content-Type": "application/json"}

TEST_YT_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

passed = 0
failed = 0
skipped = 0

def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} -- {detail}")

def skip(name, reason):
    global skipped
    skipped += 1
    print(f"  [SKIP] {name} -- {reason}")

# Phase 1: Health & Auth
print("\n--- Phase 1: Health & Auth ---")

try:
    r = requests.get(f"{BASE_URL}/status", timeout=5)
    test("1.1 GET /status", r.status_code == 200 and r.json().get("status") == "online", f"status={r.status_code}")
except Exception as e:
    test("1.1 GET /status", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/health", headers=HEADERS, timeout=5)
    data = r.json()
    test("1.2 GET /health (auth)", r.status_code == 200 and "database" in data, f"status={r.status_code}")
except Exception as e:
    test("1.2 GET /health", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/health", headers={"X-API-Key": "WRONGTKN"}, timeout=5)
    test("1.3 Auth rejection (wrong)", r.status_code == 401, f"status={r.status_code}")
except Exception as e:
    test("1.3 Auth rejection", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/health", timeout=5)
    test("1.4 Auth rejection (none)", r.status_code in [401, 403, 422], f"status={r.status_code}")
except Exception as e:
    test("1.4 Auth rejection (none)", False, str(e))

# Phase 2: Read Endpoints
print("\n--- Phase 2: Read Endpoints ---")

try:
    r = requests.get(f"{BASE_URL}/recent?limit=10", headers=HEADERS, timeout=10)
    data = r.json()
    test("2.1 GET /recent", r.status_code == 200 and "data" in data, f"status={r.status_code}")
    print(f"       found {len(data.get('data', []))} posts")
except Exception as e:
    test("2.1 GET /recent", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/categories", headers=HEADERS, timeout=10)
    data = r.json()
    test("2.2 GET /categories", r.status_code == 200 and "categories" in data, f"status={r.status_code}")
    print(f"       found {len(data.get('categories', []))} categories")
except Exception as e:
    test("2.2 GET /categories", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/queue-status", headers=HEADERS, timeout=10)
    data = r.json()
    test("2.3 GET /queue-status", r.status_code == 200 and "processing_count" in data, f"keys={list(data.keys())}")
    print(f"       processing={data.get('processing_count',0)}, queue={data.get('queue_count',0)}, retry={data.get('retry_count',0)}")
except Exception as e:
    test("2.3 GET /queue-status", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/stats", headers=HEADERS, timeout=10)
    test("2.4 GET /stats", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("2.4 GET /stats", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/search?tags=travel&limit=5", headers=HEADERS, timeout=10)
    test("2.5 GET /search?tags=travel", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("2.5 GET /search", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/queue/retry", headers=HEADERS, timeout=10)
    test("2.6 GET /queue/retry", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("2.6 GET /queue/retry", False, str(e))

# Phase 3: Collections CRUD
print("\n--- Phase 3: Collections CRUD ---")

test_collection_id = None

try:
    r = requests.get(f"{BASE_URL}/collections", headers=HEADERS, timeout=10)
    data = r.json()
    test("3.1 GET /collections", r.status_code == 200, f"status={r.status_code}")
    print(f"       found {len(data)} collections")
except Exception as e:
    test("3.1 GET /collections", False, str(e))

try:
    r = requests.post(f"{BASE_URL}/collections", headers=HEADERS, json={"id": "test-id", "name": "Test Collection", "icon": "test"}, timeout=10)
    data = r.json()
    test("3.2 POST /collections (create)", r.status_code == 200 and data.get("id"), f"status={r.status_code}")
    test_collection_id = data.get("id")
    print(f"       created ID: {test_collection_id}")
except Exception as e:
    test("3.2 POST /collections", False, str(e))

if test_collection_id:
    try:
        r = requests.post(f"{BASE_URL}/collections", headers=HEADERS, json={"id": test_collection_id, "name": "Updated Test", "icon": "ok"}, timeout=10)
        test("3.3 POST /collections (update)", r.status_code == 200, f"status={r.status_code}")
    except Exception as e:
        test("3.3 POST /collections (update)", False, str(e))

    try:
        r = requests.delete(f"{BASE_URL}/collections/{test_collection_id}", headers=HEADERS, timeout=10)
        test("3.4 DELETE /collections", r.status_code == 200, f"status={r.status_code}")
    except Exception as e:
        test("3.4 DELETE /collections", False, str(e))
else:
    skip("3.3 PUT /collections", "no collection created")
    skip("3.4 DELETE /collections", "no collection created")

try:
    r = requests.get(f"{BASE_URL}/collections", headers=HEADERS, timeout=10)
    data = r.json()
    collections = data.get("data", [])
    wl = next((c for c in collections if c.get("name") == "Watch Later"), None)
    if wl:
        r = requests.delete(f"{BASE_URL}/collections/{wl['id']}", headers=HEADERS, timeout=10)
        test("3.5 Watch Later protection", r.status_code in [400, 403], f"status={r.status_code} (should be blocked)")
    else:
        skip("3.5 Watch Later protection", "no Watch Later found")
except Exception as e:
    test("3.5 Watch Later protection", False, str(e))

# Phase 4: Settings
print("\n--- Phase 4: Settings ---")

try:
    r = requests.get(f"{BASE_URL}/settings/ai-providers", headers=HEADERS, timeout=10)
    test("4.1 GET /settings/ai-providers", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("4.1 GET /settings/ai-providers", False, str(e))

try:
    r = requests.post(f"{BASE_URL}/settings/ai-providers", headers=HEADERS,
                       json={"provider": "groq", "api_key": "gsk_test"}, timeout=10)
    test("4.2 POST ai-providers (Groq)", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("4.2 POST ai-providers", False, str(e))

try:
    r = requests.get(f"{BASE_URL}/settings/instagram", headers=HEADERS, timeout=10)
    test("4.3 GET /settings/instagram", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("4.3 GET /settings/instagram", False, str(e))

try:
    r = requests.post(f"{BASE_URL}/settings/instagram", headers=HEADERS,
                       json={"username": "testuser", "password": "testpass"}, timeout=10)
    test("4.4 POST /settings/instagram", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("4.4 POST /settings/instagram", False, str(e))

# Phase 5: Export/Import
print("\n--- Phase 5: Export/Import ---")

try:
    r = requests.get(f"{BASE_URL}/export", headers=HEADERS, timeout=15)
    test("5.1 GET /export", r.status_code == 200, f"status={r.status_code}")
    ed = r.json()
    print(f"       exported {len(ed.get('posts', []))} posts, {len(ed.get('collections', []))} collections")
except Exception as e:
    test("5.1 GET /export", False, str(e))

try:
    r = requests.post(f"{BASE_URL}/import", headers=HEADERS,
                       json={"posts": [], "collections": [], "mode": "merge"}, timeout=15)
    test("5.2 POST /import (merge, empty)", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    test("5.2 POST /import", False, str(e))

# Phase 6: Analysis
print("\n--- Phase 6: Analysis (YouTube) ---")

try:
    print("       submitting YouTube URL... (timeout 90s)")
    r = requests.post(f"{BASE_URL}/analyze", headers=HEADERS,
                       json={"url": TEST_YT_URL}, timeout=90)
    data = r.json()
    if r.status_code == 200:
        test("6.1 POST /analyze (YouTube)", data.get("success") == True, f"success={data.get('success')}")
        if data.get("data"):
            d = data["data"]
            print(f"       title: {d.get('title', 'N/A')[:60]}")
            print(f"       category: {d.get('category', 'N/A')}")
            print(f"       tags: {str(d.get('tags', [])[:5])}")
            print(f"       cached: {data.get('cached', False)}")
    elif r.status_code == 202:
        skip("6.1 POST /analyze (YouTube)", "queued for retry (quota)")
    elif r.status_code == 503:
        skip("6.1 POST /analyze (YouTube)", "503 server busy")
    else:
        test("6.1 POST /analyze (YouTube)", False, f"status={r.status_code}")
except requests.exceptions.Timeout:
    skip("6.1 POST /analyze (YouTube)", "timed out (90s)")
except Exception as e:
    test("6.1 POST /analyze (YouTube)", False, str(e))

# Summary
print("\n" + "=" * 50)
print(f"  PASSED: {passed}")
print(f"  FAILED: {failed}")
print(f"  SKIPPED: {skipped}")
print(f"  TOTAL: {passed + failed + skipped}")
print("=" * 50)

sys.exit(1 if failed > 0 else 0)
