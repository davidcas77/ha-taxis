"""AI model browsing and three-tier settings against the local dummy HA.

Provider requests, settings saves and connection tests are fixtures. No real AI
provider or Home Assistant write is contacted.
"""
import copy
import json
import os
from pathlib import Path
import unittest
import urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:8099")
TIERS = ["Low", "Medium", "Strong"]


class AiModelsRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            body = json.load(response)
        if body["hierarchy"]["home"]["name"] != "Demo House":
            raise RuntimeError("Use the local mock house")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1100}, color_scheme="dark")
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.current = {
            "enabled": True, "provider": "openai-compatible", "baseUrl": "http://localhost:1234/v1",
            "models": {"low": "saved-small", "medium": "saved-middle", "strong": "saved-large"},
            "effort": "balanced", "monthlyCapUsd": 5, "maxOutputTokens": 4096, "prices": {},
            "keySet": False, "keyEnd": None,
            "keys": {"anthropic": {"set": False, "end": None}, "openai-compatible": {"set": False, "end": None}},
        }
        self.fixture = copy.deepcopy(self.current)
        self.available = [{"id": f"demo-model-{i:03}", "name": f"Demo model {i}"} for i in range(92)]
        self.available[48]["name"] = "Special planner"
        self.puts, self.tests, self.loads, self.unexpected, self.errors = [], [], [], [], []
        self.fail_load = False
        self.held_model_route = None
        self.hold_models = False
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

        def guard(route):
            if route.request.method in ["GET", "HEAD"]:
                route.continue_()
            else:
                self.unexpected.append(route.request.url)
                route.fulfill(status=409, json={"ok": False, "error": "Unexpected write blocked"})
        self.page.route("**/api/**", guard)

        def settings(route):
            if route.request.method == "PUT":
                body = route.request.post_data_json
                self.puts.append(body)
                self.current.update(body)
            route.fulfill(json={"ok": True, "ai": self.current})
        self.page.route("**/api/settings/ai", settings)
        self.page.route("**/api/ai/usage", lambda route: route.fulfill(json={"ok": True, "usage": {"month": "2026-10", "capUsd": 5, "spentUsd": 0, "calls": 0, "unpricedCalls": 0, "inputTokens": 0, "outputTokens": 0, "byModel": []}}))

        def load(route):
            self.loads.append(route.request.post_data_json)
            if self.hold_models:
                self.held_model_route = route
            elif self.fail_load:
                route.fulfill(status=502, json={"ok": False, "error": "Fixture model-list failure"})
            else:
                route.fulfill(json={"ok": True, "models": self.available})
        self.page.route("**/api/ai/models", load)

        def test(route):
            body = route.request.post_data_json
            self.tests.append(body)
            tier = body["tier"]
            route.fulfill(json={"ok": True, "test": {"tier": tier, "model": self.current["models"][tier], "provider": self.current["provider"], "reply": "ready", "inputTokens": 1, "outputTokens": 1, "costUsd": None, "ms": 1, "stop": "end"}})
        self.page.route("**/api/ai/test", test)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.unexpected, [])
        self.assertEqual(self.errors, [])

    def open(self):
        self.page.goto(BASE + "/#settings", wait_until="networkidle")
        self.page.get_by_label("Strong model", exact=True).wait_for()

    def load(self):
        self.page.get_by_role("button", name="Load models", exact=True).click()
        self.page.get_by_role("region", name="Available models (92)", exact=True).wait_for()

    def test_all_92_models_are_browsable_searchable_and_collapsible(self):
        self.open()
        self.load()
        models = self.page.get_by_role("list", name="Available AI models", exact=True)
        self.assertEqual(models.get_by_role("listitem").count(), 92)
        self.assertTrue(models.evaluate("e => e.scrollHeight > e.clientHeight"))
        search = self.page.get_by_label("Search available models", exact=True)
        search.fill("special PLANNER")
        self.assertEqual(models.get_by_role("listitem").count(), 1)
        self.assertIn("demo-model-048", models.inner_text())
        search.fill("missing-model")
        self.page.get_by_text("No models match this search.", exact=True).wait_for()
        search.fill("")
        self.page.get_by_role("button", name="Hide models", exact=True).click()
        self.assertFalse(search.is_visible())
        self.page.get_by_role("button", name="Show models", exact=True).click()
        self.assertTrue(search.is_visible())
        self.assertEqual(self.puts, [])
        self.assertEqual(self.tests, [])
        self.assertEqual(self.current, self.fixture)
        output = Path(os.environ.get("TAXIS_SCREENSHOT_DIR", "output/playwright"))
        output.mkdir(parents=True, exist_ok=True)
        self.page.get_by_role("region", name="Available models (92)", exact=True).scroll_into_view_if_needed()
        self.page.screenshot(path=str(output / "ai-three-tiers-and-model-list.png"))

    def test_assign_each_tier_save_and_reload_without_running_a_model(self):
        self.open()
        self.load()
        for index, tier in enumerate(TIERS):
            model = f"demo-model-{index:03}"
            button = self.page.get_by_role("button", name=f"Use {model} for {tier}", exact=True)
            button.focus()
            self.page.keyboard.press("Enter")
            self.assertEqual(self.page.get_by_label(tier + " model", exact=True).input_value(), model)
            self.assertEqual(button.get_attribute("aria-pressed"), "true")
        self.assertEqual(self.puts, [])
        self.assertEqual(self.tests, [])
        self.page.get_by_role("button", name="Save AI settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="AI settings saved").wait_for()
        self.assertEqual(self.puts[0]["models"], {"low": "demo-model-000", "medium": "demo-model-001", "strong": "demo-model-002"})
        self.assertEqual(self.puts[0]["monthlyCapUsd"], 5)
        self.assertNotIn("key", self.puts[0])
        self.page.reload(wait_until="networkidle")
        for index, tier in enumerate(TIERS):
            self.assertEqual(self.page.get_by_label(tier + " model", exact=True).input_value(), f"demo-model-{index:03}")
        self.assertEqual(self.tests, [])

    def test_direct_model_ids_and_unsaved_draft_guard_remain_supported(self):
        self.open()
        self.page.get_by_label("Strong model", exact=True).fill("custom/model-not-listed")
        dialogs = []
        def dismiss(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()
        self.page.once("dialog", dismiss)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Areas", exact=True).click()
        self.assertEqual(len(dialogs), 1)
        self.assertTrue(self.page.url.endswith("#settings"))
        self.assertEqual(self.page.get_by_label("Strong model", exact=True).input_value(), "custom/model-not-listed")
        ai = self.page.locator("section[aria-labelledby='ai-heading']")
        ai.get_by_role("button", name="Undo changes", exact=True).click()
        self.assertEqual(self.page.get_by_label("Strong model", exact=True).input_value(), "saved-large")
        self.assertEqual(self.puts, [])

    def test_connection_buttons_use_each_saved_tier_and_missing_strong_is_disabled(self):
        self.current["models"]["strong"] = ""
        self.open()
        self.assertTrue(self.page.get_by_role("button", name="Test the Strong model", exact=True).is_disabled())
        for tier in ["Low", "Medium"]:
            self.page.get_by_role("button", name=f"Test the {tier} model", exact=True).click()
            self.page.get_by_text(f"{tier} tier", exact=False).wait_for()
        self.assertEqual(self.tests, [{"tier": "low"}, {"tier": "medium"}])
        self.assertEqual(self.puts, [])

    def test_empty_and_failed_reload_do_not_leave_stale_model_lists(self):
        self.open()
        self.load()
        self.fail_load = True
        self.page.get_by_role("button", name="Load models", exact=True).click()
        self.page.get_by_role("alert").filter(has_text="Fixture model-list failure").wait_for()
        self.assertEqual(self.page.get_by_role("list", name="Available AI models").count(), 0)
        self.fail_load = False
        self.available = []
        self.page.get_by_role("button", name="Load models", exact=True).click()
        self.page.get_by_text("The service lists no models.", exact=True).wait_for()
        self.assertEqual(self.page.get_by_role("list", name="Available AI models").count(), 0)
        self.assertEqual(self.current, self.fixture)

    def test_switching_provider_ignores_the_previous_inflight_model_response(self):
        self.open()
        self.hold_models = True
        self.page.get_by_role("button", name="Load models", exact=True).click()
        self.page.get_by_label("Provider", exact=True).select_option("anthropic")
        self.assertIsNotNone(self.held_model_route)
        with self.page.expect_response("**/api/ai/models"):
            self.held_model_route.fulfill(json={"ok": True, "models": self.available})
        self.page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        self.assertEqual(self.page.get_by_role("list", name="Available AI models").count(), 0)
        self.assertEqual(self.page.get_by_label("Strong model", exact=True).input_value(), "")
        self.assertTrue(self.page.get_by_role("button", name="Load models", exact=True).is_disabled())
        self.assertEqual(self.puts, [])

    def test_empty_tiers_are_not_auto_assigned_and_mobile_list_stays_inside_viewport(self):
        self.current["models"] = {"low": "", "medium": "", "strong": ""}
        self.open()
        self.load()
        for tier in TIERS:
            self.assertEqual(self.page.get_by_label(tier + " model", exact=True).input_value(), "")
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.get_by_label("Search available models", exact=True).fill("demo-model-091")
        self.page.get_by_role("button", name="Use demo-model-091 for Strong", exact=True).click()
        self.assertEqual(self.page.get_by_label("Strong model", exact=True).input_value(), "demo-model-091")
        self.assertEqual(self.puts, [])
        self.assertEqual(self.tests, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
