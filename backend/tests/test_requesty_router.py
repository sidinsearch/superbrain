#!/usr/bin/env python3
"""Requesty is opt-in: only used when a key is set, never part of the ranked fallback order."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import core.model_router as model_router_module  # noqa: E402

PROVIDER_ENV_VARS = ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "REQUESTY_API_KEY", "REQUESTY_MODEL")


class RequestyRouterTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        temp = Path(self.temp_dir.name)
        self.patches = [
            mock.patch.object(model_router_module, "API_KEYS_FILE", temp / ".api_keys"),
            mock.patch.object(model_router_module, "RANKINGS_FILE", temp / "model_rankings.json"),
            mock.patch.dict(os.environ, {}, clear=False),
        ]
        for p in self.patches:
            p.start()
        for k in PROVIDER_ENV_VARS:
            os.environ.pop(k, None)

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp_dir.cleanup()

    def _router(self, **keys):
        os.environ.update(keys)
        return model_router_module.ModelRouter()

    def test_requesty_is_never_in_ranked_fallback_order(self):
        router = self._router(REQUESTY_API_KEY="test-key")
        for task in ("text", "vision"):
            providers = {model_router_module.MODELS_BY_KEY[k]["provider"] for k in router._ranked_models(task)}
            self.assertNotIn("requesty", providers)
        self.assertTrue(router.get_available_providers()["requesty"])

    def test_requesty_not_called_without_key(self):
        router = self._router()
        with mock.patch.object(router, "_requesty_text", side_effect=AssertionError("should not be called")), \
                mock.patch.object(router, "_ollama_text", return_value="local"):
            self.assertEqual(router.generate_text("hi"), "local")

    def test_requesty_uses_selected_model_when_key_set(self):
        router = self._router(REQUESTY_API_KEY="test-key", REQUESTY_MODEL="anthropic/claude-sonnet-4-5")
        fake = mock.Mock(status_code=200)
        fake.json.return_value = {"choices": [{"message": {"content": " hello "}}]}
        with mock.patch("requests.post", return_value=fake) as post:
            self.assertEqual(router.generate_text("hi"), "hello")
        url = post.call_args.args[0]
        body = post.call_args.kwargs["json"]
        self.assertEqual(url, f"{model_router_module.REQUESTY_BASE_URL}/chat/completions")
        self.assertEqual(body["model"], "anthropic/claude-sonnet-4-5")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer test-key")

    def test_requesty_failure_falls_back_to_normal_chain(self):
        router = self._router(REQUESTY_API_KEY="test-key")
        with mock.patch.object(router, "_requesty_vision", side_effect=RuntimeError("boom")), \
                mock.patch.object(router, "_ollama_vision", return_value="local vision"):
            self.assertEqual(router.analyze_images("describe", ["aGk="]), "local vision")


if __name__ == "__main__":
    unittest.main()
