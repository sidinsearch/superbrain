#!/usr/bin/env python3
"""
AI Model Router for SuperBrain
================================
Multi-provider routing with automatic fallback, response-time ranking,
and dynamic re-ranking as models change speed or go down.

Priority order (defaults, adjusted dynamically by measured latency):
  TEXT:   Groq → Gemini → OpenRouter → Local Ollama  (last resort)
  VISION: Gemini → Groq Vision → OpenRouter Vision → Local Ollama Vision

API keys — store in backend/.api_keys (gitignored), one per line:
    GROQ_API_KEY=gsk_...
    GEMINI_API_KEY=AIza...
    OPENROUTER_API_KEY=sk-or-...

Performance state is persisted to backend/model_rankings.json so rankings
survive process restarts and improve over time.
"""

import os
import json
import time
import base64
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

CONFIG_DIR    = Path(__file__).parent
RANKINGS_FILE = CONFIG_DIR / "model_rankings.json"
API_KEYS_FILE = CONFIG_DIR / ".api_keys"

# How long to cool-down a failing model before retrying (seconds)
MODEL_DOWN_COOLDOWN_S = 300
# Exponential moving average weight for response-time estimates
EMA_ALPHA = 0.3

# ─────────────────────────────────────────────────────────────────────────────
#  MODEL REGISTRY
#  Each entry defines the key, provider, model ID, task type, and base priority.
#  base_priority: lower = preferred.  100+ = local last-resort.
# ─────────────────────────────────────────────────────────────────────────────

MODELS: List[Dict[str, Any]] = [
    # ── TEXT ─────────────────────────────────────────────────────────────────
    {
        "key": "groq_llama33_70b",
        "provider": "groq",
        "model_id": "llama-3.3-70b-versatile",
        "type": "text",
        "base_priority": 1,
        "desc": "Groq LLaMA-3.3 70B — fastest large text model (free tier)",
    },
    {
        "key": "groq_llama31_8b",
        "provider": "groq",
        "model_id": "llama-3.1-8b-instant",
        "type": "text",
        "base_priority": 2,
        "desc": "Groq LLaMA-3.1 8B — ultra-fast, great for summaries",
    },
    {
        "key": "groq_gemma2_9b",
        "provider": "groq",
        "model_id": "gemma2-9b-it",
        "type": "text",
        "base_priority": 3,
        "desc": "Groq Gemma-2 9B",
    },
    {
        "key": "gemini_20_flash",
        "provider": "gemini",
        "model_id": "gemini-2.0-flash",
        "type": "text",
        "base_priority": 4,
        "desc": "Gemini 2.0 Flash — generous free tier, fast",
    },
    {
        "key": "gemini_20_flash_lite",
        "provider": "gemini",
        "model_id": "gemini-2.0-flash-lite",
        "type": "text",
        "base_priority": 5,
        "desc": "Gemini 2.0 Flash Lite — lightest/fastest Gemini",
    },
    {
        "key": "gemini_15_flash",
        "provider": "gemini",
        "model_id": "gemini-1.5-flash",
        "type": "text",
        "base_priority": 6,
        "desc": "Gemini 1.5 Flash",
    },
    {
        "key": "openrouter_llama33_70b",
        "provider": "openrouter",
        "model_id": "meta-llama/llama-3.3-70b-instruct:free",
        "type": "text",
        "base_priority": 7,
        "desc": "OpenRouter LLaMA-3.3 70B (free)",
    },
    {
        "key": "openrouter_qwen25_72b",
        "provider": "openrouter",
        "model_id": "qwen/qwen-2.5-72b-instruct:free",
        "type": "text",
        "base_priority": 8,
        "desc": "OpenRouter Qwen-2.5 72B (free)",
    },
    {
        "key": "openrouter_deepseek_r1",
        "provider": "openrouter",
        "model_id": "deepseek/deepseek-r1:free",
        "type": "text",
        "base_priority": 9,
        "desc": "OpenRouter DeepSeek R1 (free)",
    },
    {
        "key": "openrouter_phi4",
        "provider": "openrouter",
        "model_id": "microsoft/phi-4:free",
        "type": "text",
        "base_priority": 10,
        "desc": "OpenRouter Microsoft Phi-4 (free)",
    },
    {
        "key": "local_qwen3",
        "provider": "ollama",
        "model_id": "qwen3:latest",
        "type": "text",
        "base_priority": 100,
        "desc": "Local Ollama Qwen3 — LAST RESORT (requires Ollama running)",
    },

    # ── VISION ───────────────────────────────────────────────────────────────
    {
        "key": "gemini_20_flash_vision",
        "provider": "gemini",
        "model_id": "gemini-2.0-flash",
        "type": "vision",
        "base_priority": 1,
        "desc": "Gemini 2.0 Flash — best free vision, 1M token context",
    },
    {
        "key": "gemini_20_flash_lite_vision",
        "provider": "gemini",
        "model_id": "gemini-2.0-flash-lite",
        "type": "vision",
        "base_priority": 2,
        "desc": "Gemini 2.0 Flash Lite — fastest free vision",
    },
    {
        "key": "gemini_15_flash_vision",
        "provider": "gemini",
        "model_id": "gemini-1.5-flash",
        "type": "vision",
        "base_priority": 3,
        "desc": "Gemini 1.5 Flash vision",
    },
    {
        "key": "gemini_15_flash_8b_vision",
        "provider": "gemini",
        "model_id": "gemini-1.5-flash-8b",
        "type": "vision",
        "base_priority": 4,
        "desc": "Gemini 1.5 Flash 8B — lightweight vision",
    },
    {
        "key": "groq_vision_11b",
        "provider": "groq",
        "model_id": "llama-3.2-11b-vision-preview",
        "type": "vision",
        "base_priority": 5,
        "desc": "Groq LLaMA-3.2 11B Vision",
    },
    {
        "key": "groq_vision_90b",
        "provider": "groq",
        "model_id": "llama-3.2-90b-vision-preview",
        "type": "vision",
        "base_priority": 6,
        "desc": "Groq LLaMA-3.2 90B Vision — highest quality Groq vision",
    },
    {
        "key": "openrouter_gemini_vision",
        "provider": "openrouter",
        "model_id": "google/gemini-2.0-flash-exp:free",
        "type": "vision",
        "base_priority": 7,
        "desc": "OpenRouter Gemini 2.0 Flash exp (free)",
    },
    {
        "key": "openrouter_qwen_vl",
        "provider": "openrouter",
        "model_id": "qwen/qwen2.5-vl-72b-instruct:free",
        "type": "vision",
        "base_priority": 8,
        "desc": "OpenRouter Qwen-2.5 VL 72B (free)",
    },
    {
        "key": "openrouter_llama_vision",
        "provider": "openrouter",
        "model_id": "meta-llama/llama-3.2-11b-vision-instruct:free",
        "type": "vision",
        "base_priority": 9,
        "desc": "OpenRouter LLaMA-3.2 11B Vision (free)",
    },
    {
        "key": "local_qwen3_vl",
        "provider": "ollama",
        "model_id": "qwen3-vl:latest",
        "type": "vision",
        "base_priority": 100,
        "desc": "Local Ollama Qwen3-VL — LAST RESORT (requires Ollama running)",
    },
]

MODELS_BY_KEY: Dict[str, Dict] = {m["key"]: m for m in MODELS}


# ─────────────────────────────────────────────────────────────────────────────
#  MODEL ROUTER
# ─────────────────────────────────────────────────────────────────────────────

class ModelRouter:
    """
    Routes AI requests to the best available model.
    - Tries models in order of effective priority (base + response-time penalty)
    - Marks failed models as 'down' for MODEL_DOWN_COOLDOWN_S seconds
    - Updates EMA response-time estimates after each successful call
    - Saves state to model_rankings.json so rankings persist across restarts
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._api_keys: Dict[str, str] = {}
        self._state: Dict[str, Dict] = {}
        self._load_api_keys()
        self._load_state()
        self._print_startup_status()

    # ── Configuration ─────────────────────────────────────────────────────────

    def _load_api_keys(self):
        """Load API keys from environment and .api_keys file."""
        for k in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"):
            v = os.environ.get(k)
            if v:
                self._api_keys[k] = v

        if API_KEYS_FILE.exists():
            with open(API_KEYS_FILE, "r") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        self._api_keys[k.strip()] = v.strip()

    def _key(self, name: str) -> Optional[str]:
        return self._api_keys.get(name) or None

    # ── State persistence ──────────────────────────────────────────────────────

    def _default_model_state(self, model_key: str) -> Dict:
        m = MODELS_BY_KEY[model_key]
        return {
            "key": model_key,
            "avg_response_s": None,   # EMA; None = not measured yet
            "success_count": 0,
            "fail_count": 0,
            "down_until": None,       # ISO timestamp; None = available
            "last_used": None,
            "last_error": None,
            "base_priority": m["base_priority"],
        }

    def _load_state(self):
        if RANKINGS_FILE.exists():
            try:
                with open(RANKINGS_FILE, "r") as f:
                    saved = json.load(f)
                for key in MODELS_BY_KEY:
                    self._state[key] = saved.get(key, self._default_model_state(key))
                return
            except Exception:
                pass
        for key in MODELS_BY_KEY:
            self._state[key] = self._default_model_state(key)

    def _save_state(self):
        try:
            with open(RANKINGS_FILE, "w") as f:
                json.dump(self._state, f, indent=2, default=str)
        except Exception:
            pass

    # ── Availability & ranking ─────────────────────────────────────────────────

    def _is_available(self, model_key: str) -> bool:
        """True if the model has an API key (or is local) and is not in cooldown."""
        m = MODELS_BY_KEY[model_key]
        prov = m["provider"]

        if prov == "groq" and not self._key("GROQ_API_KEY"):
            return False
        if prov == "gemini" and not self._key("GEMINI_API_KEY"):
            return False
        if prov == "openrouter" and not self._key("OPENROUTER_API_KEY"):
            return False

        s = self._state.get(model_key, self._default_model_state(model_key))
        if s.get("down_until"):
            try:
                if datetime.utcnow() < datetime.fromisoformat(s["down_until"]):
                    return False
            except Exception:
                pass
        return True

    def _effective_priority(self, model_key: str) -> float:
        """
        Compute sort key (lower = better).
        = base_priority + response_time_penalty (0–10)
        Unmeasured models keep their exact base_priority.
        """
        s = self._state.get(model_key, self._default_model_state(model_key))
        base = s.get("base_priority", MODELS_BY_KEY[model_key]["base_priority"])
        avg_t = s.get("avg_response_s")
        if avg_t is None:
            return float(base)
        # Each extra 3 s above a 2 s baseline adds 1 point of penalty (max 10)
        penalty = min(10.0, max(0.0, (avg_t - 2.0) / 3.0))
        return float(base) + penalty

    def _ranked_models(self, task_type: str) -> List[str]:
        """Return available model keys for task_type, best first."""
        candidates = [
            k for k, m in MODELS_BY_KEY.items()
            if m["type"] == task_type and self._is_available(k)
        ]
        return sorted(candidates, key=self._effective_priority)

    # ── State recording ────────────────────────────────────────────────────────

    def _record_success(self, model_key: str, elapsed: float):
        with self._lock:
            s = self._state[model_key]
            prev = s["avg_response_s"]
            s["avg_response_s"] = (
                elapsed if prev is None
                else EMA_ALPHA * elapsed + (1 - EMA_ALPHA) * prev
            )
            s["success_count"] = s.get("success_count", 0) + 1
            s["down_until"] = None
            s["last_used"] = datetime.utcnow().isoformat()
            s["last_error"] = None
            self._save_state()

    def _record_failure(self, model_key: str, error: str):
        with self._lock:
            s = self._state[model_key]
            s["fail_count"] = s.get("fail_count", 0) + 1
            s["last_error"] = str(error)[:200]
            s["down_until"] = (
                datetime.utcnow() + timedelta(seconds=MODEL_DOWN_COOLDOWN_S)
            ).isoformat()
            self._save_state()
        print(
            f"  ⚠️  [{model_key}] marked DOWN for {MODEL_DOWN_COOLDOWN_S}s "
            f"— {str(error)[:80]}"
        )

    # ── Provider implementations ───────────────────────────────────────────────

    def _groq_text(self, model_id: str, prompt: str) -> str:
        from groq import Groq
        client = Groq(api_key=self._key("GROQ_API_KEY"))
        r = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=800,
            temperature=0.7,
        )
        return r.choices[0].message.content.strip()

    def _groq_vision(self, model_id: str, prompt: str, images_b64: List[str]) -> str:
        from groq import Groq
        client = Groq(api_key=self._key("GROQ_API_KEY"))
        # Groq vision: send up to 1 image (11b model limit)
        content: List[Dict] = []
        for b64 in images_b64[:1]:  # Groq supports 1 image per request
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            })
        content.append({"type": "text", "text": prompt})
        r = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": content}],
            max_tokens=800,
            temperature=0.7,
        )
        return r.choices[0].message.content.strip()

    def _gemini_text(self, model_id: str, prompt: str) -> str:
        import google.generativeai as genai
        genai.configure(api_key=self._key("GEMINI_API_KEY"))
        model = genai.GenerativeModel(model_id)
        r = model.generate_content(
            prompt,
            generation_config={"max_output_tokens": 800, "temperature": 0.7},
        )
        return r.text.strip()

    def _gemini_vision(self, model_id: str, prompt: str, images_b64: List[str]) -> str:
        import google.generativeai as genai
        genai.configure(api_key=self._key("GEMINI_API_KEY"))
        model = genai.GenerativeModel(model_id)
        parts: List[Any] = []
        for b64 in images_b64:
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": b64}})
        parts.append(prompt)
        r = model.generate_content(
            parts,
            generation_config={"max_output_tokens": 800, "temperature": 0.7},
        )
        return r.text.strip()

    def _openrouter_text(self, model_id: str, prompt: str) -> str:
        import requests
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self._key('OPENROUTER_API_KEY')}",
                "HTTP-Referer": "https://github.com/superbrain",
                "X-Title": "SuperBrain",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
                "temperature": 0.7,
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

    def _openrouter_vision(self, model_id: str, prompt: str, images_b64: List[str]) -> str:
        import requests
        content: List[Dict] = []
        for b64 in images_b64:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            })
        content.append({"type": "text", "text": prompt})
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self._key('OPENROUTER_API_KEY')}",
                "HTTP-Referer": "https://github.com/superbrain",
                "X-Title": "SuperBrain",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": 800,
                "temperature": 0.7,
            },
            timeout=90,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

    def _ollama_text(self, model_id: str, prompt: str) -> str:
        import ollama
        r = ollama.generate(
            model=model_id,
            prompt=prompt,
            options={"temperature": 0.7, "num_predict": 800},
        )
        return r.get("response", "").strip()

    def _ollama_vision(self, model_id: str, prompt: str, images_b64: List[str]) -> str:
        import ollama
        r = ollama.generate(
            model=model_id,
            prompt=prompt,
            images=images_b64,
            options={"temperature": 0.7, "num_predict": 800},
        )
        return r.get("response", "").strip()

    # ── Public API ─────────────────────────────────────────────────────────────

    def generate_text(self, prompt: str) -> str:
        """
        Generate text using the best available model.
        Falls back through the ranked list until one succeeds.
        Raises RuntimeError if all fail.
        """
        ranked = self._ranked_models("text")
        if not ranked:
            raise RuntimeError(
                "No text models available. Add API keys to backend/.api_keys"
            )

        for key in ranked:
            m = MODELS_BY_KEY[key]
            print(f"  🤖 [{m['provider'].upper()}] {m['model_id']} ...", flush=True)
            t0 = time.time()
            try:
                prov = m["provider"]
                if prov == "groq":
                    result = self._groq_text(m["model_id"], prompt)
                elif prov == "gemini":
                    result = self._gemini_text(m["model_id"], prompt)
                elif prov == "openrouter":
                    result = self._openrouter_text(m["model_id"], prompt)
                elif prov == "ollama":
                    result = self._ollama_text(m["model_id"], prompt)
                else:
                    continue

                elapsed = time.time() - t0
                self._record_success(key, elapsed)
                print(f"  ✓ {elapsed:.1f}s", flush=True)
                return result

            except Exception as e:
                self._record_failure(key, str(e))
                print(f"  ✗ Failed ({type(e).__name__}), trying next …", flush=True)

        raise RuntimeError("All text models failed.")

    def analyze_images(self, prompt: str, images_b64: List[str]) -> str:
        """
        Analyze one or more images using the best available vision model.
        images_b64: list of base64-encoded JPEG strings.
        Falls back through the ranked list until one succeeds.
        Raises RuntimeError if all fail.
        """
        ranked = self._ranked_models("vision")
        if not ranked:
            raise RuntimeError(
                "No vision models available. Add API keys to backend/.api_keys"
            )

        for key in ranked:
            m = MODELS_BY_KEY[key]
            print(f"  🔭 [{m['provider'].upper()}] {m['model_id']} ...", flush=True)
            t0 = time.time()
            try:
                prov = m["provider"]
                if prov == "groq":
                    result = self._groq_vision(m["model_id"], prompt, images_b64)
                elif prov == "gemini":
                    result = self._gemini_vision(m["model_id"], prompt, images_b64)
                elif prov == "openrouter":
                    result = self._openrouter_vision(m["model_id"], prompt, images_b64)
                elif prov == "ollama":
                    result = self._ollama_vision(m["model_id"], prompt, images_b64)
                else:
                    continue

                elapsed = time.time() - t0
                self._record_success(key, elapsed)
                print(f"  ✓ {elapsed:.1f}s", flush=True)
                return result

            except Exception as e:
                self._record_failure(key, str(e))
                print(f"  ✗ Failed ({type(e).__name__}), trying next …", flush=True)

        raise RuntimeError("All vision models failed.")

    # ── Utilities ──────────────────────────────────────────────────────────────

    def print_rankings(self):
        """Print a full ranked table of all models with performance stats."""
        print("\n" + "=" * 80)
        print("🏆  AI MODEL RANKINGS  (auto-sorted by speed + reliability)")
        print("=" * 80)
        for task_type in ("text", "vision"):
            print(f"\n{'─' * 80}")
            print(f"  {task_type.upper()} MODELS  (rank 1 = currently preferred)")
            print(f"{'─' * 80}")
            all_keys = [k for k, m in MODELS_BY_KEY.items() if m["type"] == task_type]
            sorted_keys = sorted(all_keys, key=self._effective_priority)
            for i, key in enumerate(sorted_keys, 1):
                m = MODELS_BY_KEY[key]
                s = self._state.get(key, self._default_model_state(key))
                avail = "✓ UP  " if self._is_available(key) else "✗ DOWN"
                avg_t = s["avg_response_s"]
                avg_str = f"{avg_t:5.1f}s" if avg_t is not None else "  new "
                n_ok  = s.get("success_count", 0)
                n_err = s.get("fail_count", 0)
                print(
                    f"  {i:2}. [{avail}] "
                    f"{m['provider']:<12} "
                    f"{m['model_id']:<48} "
                    f"avg={avg_str}  ok={n_ok}  fail={n_err}"
                )
        print()

    def reset_model(self, model_key: str):
        """Manually clear the down-cooldown for a specific model key."""
        if model_key in self._state:
            with self._lock:
                self._state[model_key]["down_until"] = None
                self._state[model_key]["fail_count"] = 0
                self._save_state()
            print(f"✓ Reset model: {model_key}")
        else:
            print(f"Unknown model key: {model_key}")

    def _print_startup_status(self):
        parts = []
        parts.append("Groq ✓"        if self._key("GROQ_API_KEY")        else "Groq ✗")
        parts.append("Gemini ✓"      if self._key("GEMINI_API_KEY")      else "Gemini ✗")
        parts.append("OpenRouter ✓"  if self._key("OPENROUTER_API_KEY")  else "OpenRouter ✗")
        parts.append("Ollama (fallback)")
        print(f"🌐 Model Router initialised: {' | '.join(parts)}")


# ─────────────────────────────────────────────────────────────────────────────
#  Singleton
# ─────────────────────────────────────────────────────────────────────────────

_router_instance: Optional[ModelRouter] = None
_router_lock = threading.Lock()


def get_router() -> ModelRouter:
    """Get or create the shared ModelRouter instance."""
    global _router_instance
    if _router_instance is None:
        with _router_lock:
            if _router_instance is None:
                _router_instance = ModelRouter()
    return _router_instance


# ─────────────────────────────────────────────────────────────────────────────
#  CLI — run this file directly to inspect rankings or reset a model
#  Usage:
#    python model_router.py                  → show rankings
#    python model_router.py reset <key>      → clear cooldown for model key
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys as _sys
    router = get_router()
    if len(_sys.argv) >= 3 and _sys.argv[1] == "reset":
        router.reset_model(_sys.argv[2])
    else:
        router.print_rankings()
