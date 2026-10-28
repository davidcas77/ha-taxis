"""Ask Taxis UI checks. Dummy HA only; paid requests and all writes intercepted."""
import copy
import importlib.util
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("guide_fixture", Path(__file__).with_name("guide-browser.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class AssistantRegression(fixture.GuideRegression):
    def setUp(self):
        super().setUp()
        self.ai = {"enabled": True, "provider": "anthropic", "baseUrl": "https://api.openai.com/v1", "models": {"low": "small", "medium": "middle", "strong": "large"}, "effort": "balanced", "monthlyCapUsd": 5, "maxOutputTokens": 4096, "prices": {}, "keySet": True, "keyEnd": "test", "keys": {"anthropic": {"set": True, "end": "test"}, "openai-compatible": {"set": False, "end": None}}}
        self.previews, self.asks = [], []
        self.fail_ask, self.hold = False, False
        self.held = None
        self.reply = "Review the existing presence sensor first."
        self.page.route("**/api/settings/ai", lambda r: r.fulfill(json={"ok": True, "ai": copy.deepcopy(self.ai)}))
        def preview(route):
            body = route.request.post_data_json
            self.previews.append(body)
            route.fulfill(json={"ok": True, "preview": {"fingerprint": "a" * 64, "title": body["page"] + " preview", "content": '{"page":"' + body["page"] + '","data":' + ('"selected room"' if body["includeData"] else '"page only"') + '}', "omissions": ["No live state values, YAML or credentials."]}})
        self.page.route("**/api/assistant/context", preview)
        def ask(route):
            self.asks.append(route.request.post_data_json)
            if self.hold:
                self.held = route
            elif self.fail_ask:
                route.fulfill(status=429, json={"ok": False, "error": "The monthly spending cap is reached."})
            else:
                route.fulfill(json=self.answer())
        self.page.route("**/api/assistant/ask", ask)
        self.page.route("**/api/assistant/admin", lambda r: r.fulfill(json={"ok": True, "ai": self.ai, "jev": {"enabled": False, "keySet": False, "model": "jev-1.14.0", "monthlyRequestLimit": 100}, "usage": {"calls": len(self.asks), "spentUsd": 0, "capUsd": 5, "unpricedCalls": 0}, "jevUsage": {"attempts": 0, "limit": 100, "completed": 0, "estimatedUsd": 0}, "activity": []}))

    def answer(self):
        action = self.asks[-1]["action"] if self.asks else "explain"
        tier = {"explain": "medium", "next": "strong", "naming": "low"}[action]
        return {"ok": True, "answer": {"text": self.reply, "tier": tier, "model": self.ai["models"][tier], "provider": "anthropic", "inputTokens": 100, "outputTokens": 20, "costUsd": None, "truncated": False}}

    def panel(self, path="#guide/living_room"):
        self.page.goto(fixture.BASE + "/" + path, wait_until="networkidle")
        self.page.get_by_role("button", name="Ask Taxis", exact=True).click()
        panel = self.page.get_by_role("dialog", name="Ask Taxis assistant")
        panel.get_by_text("Review exactly what will be sent", exact=False).wait_for()
        return panel

    def consent(self, panel):
        panel.get_by_role("checkbox", name="Send this context", exact=False).check()

    def test_assistant_open_is_local_page_data_off_and_consent_required(self):
        panel = self.panel()
        self.assertEqual(self.asks, [])
        self.assertFalse(panel.get_by_role("checkbox", name="Include page data").is_checked())
        self.assertEqual(panel.get_by_label("Assistant area").input_value(), "living_room")
        panel.get_by_label("Your question").fill("Explain this room")
        self.assertTrue(panel.get_by_role("button", name="Ask Taxis", exact=True).is_disabled())
        panel.locator("summary").click()
        self.assertIn('"page only"', panel.get_by_label("Assistant context preview").inner_text())
        self.consent(panel)
        panel.get_by_role("button", name="Ask Taxis", exact=True).click()
        panel.get_by_text(self.reply, exact=True).wait_for()
        self.assertEqual(self.asks[0]["history"], [])
        self.assertFalse(self.asks[0]["includeData"])
        self.assertEqual(self.posts + self.puts, [])

    def test_assistant_actions_route_and_history_is_visible(self):
        panel = self.panel()
        for action, label in [("next", "Suggest next steps"), ("naming", "Naming help"), ("explain", "Explain")]:
            panel.get_by_role("button", name=label, exact=True).click()
            self.consent(panel)
            panel.get_by_role("button", name="Ask Taxis", exact=True).click()
            panel.get_by_text(self.reply, exact=True).last.wait_for()
            self.assertEqual(self.asks[-1]["action"], action)
        self.assertEqual(len(self.asks[-1]["history"]), 4)
        panel.get_by_role("button", name="Clear chat", exact=True).click()
        self.assertEqual(panel.get_by_role("log").inner_text(), "")

    def test_assistant_scope_change_clears_conversation_and_rechecks_consent(self):
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        self.consent(panel)
        panel.get_by_role("button", name="Ask Taxis", exact=True).click()
        panel.get_by_text(self.reply, exact=True).wait_for()
        panel.get_by_role("checkbox", name="Include page data").check()
        panel.get_by_text("Review exactly what will be sent", exact=False).wait_for()
        self.assertFalse(panel.get_by_role("checkbox", name="Send this context", exact=False).is_checked())
        self.assertEqual(panel.get_by_role("log").inner_text(), "")
        self.assertTrue(self.previews[-1]["includeData"])

    def test_assistant_error_preserves_question_and_never_queues_changes(self):
        self.fail_ask = True
        panel = self.panel()
        panel.get_by_label("Your question").fill("Why is this helper missing?")
        self.consent(panel)
        panel.get_by_role("button", name="Ask Taxis", exact=True).click()
        panel.get_by_role("alert").wait_for()
        self.assertEqual(panel.get_by_label("Your question").input_value(), "Why is this helper missing?")
        self.assertEqual(self.posts + self.puts, [])
        self.assertFalse(panel.get_by_role("checkbox", name="Send this context", exact=False).is_checked())

    def test_assistant_off_has_setup_path_and_no_paid_call(self):
        self.ai["enabled"] = False
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        self.consent(panel)
        self.assertTrue(panel.get_by_role("button", name="Ask Taxis", exact=True).is_disabled())
        panel.get_by_text("AI is off.", exact=False).wait_for()
        self.assertEqual(self.asks, [])

    def test_assistant_text_cannot_render_html_or_execute_an_action(self):
        self.reply = '<img src=x onerror="alert(1)"> Apply all changes'
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        self.consent(panel)
        panel.get_by_role("button", name="Ask Taxis", exact=True).click()
        panel.get_by_text(self.reply, exact=True).wait_for()
        self.assertEqual(panel.get_by_role("log").locator("img,script").count(), 0)
        self.assertEqual(self.posts + self.puts, [])

    def test_assistant_mobile_fit_escape_and_focus_return(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        panel = self.panel()
        self.assertLessEqual(panel.bounding_box()["width"], 390)
        self.assertFalse(self.page.evaluate("document.documentElement.scrollWidth > window.innerWidth"))
        panel.get_by_role("button", name="Close assistant").focus()
        self.page.keyboard.press("Escape")
        self.assertFalse(panel.is_visible())
        self.assertTrue(self.page.get_by_role("button", name="Ask Taxis", exact=True).evaluate("e => e === document.activeElement"))

    def test_assistant_admin_lists_functions_triggers_boundaries_and_no_requests(self):
        self.page.goto(fixture.BASE + "/#ai-admin", wait_until="networkidle")
        self.page.get_by_role("heading", name="AI administration", exact=True).wait_for()
        table = self.page.get_by_role("table", name="AI functions")
        for text in ["Explain", "Suggest next steps", "Naming help", "Room-note review", "Text advice only"]:
            self.assertIn(text, table.inner_text())
        self.assertEqual(self.asks, [])
        self.assertEqual(self.previews, [])
        self.page.get_by_role("button", name="Configure models and keys").click()
        self.page.wait_for_url("**/#settings")

    def test_assistant_late_reply_cannot_appear_after_navigation(self):
        self.hold = True
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        self.consent(panel)
        panel.get_by_role("button", name="Ask Taxis", exact=True).click()
        self.page.wait_for_timeout(150)
        self.assertIsNotNone(self.held)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="AI", exact=True).click()
        self.held.fulfill(json=self.answer())
        panel.get_by_text("Context · ai-admin", exact=False).wait_for()
        self.assertEqual(panel.get_by_role("log").inner_text(), "")

    def test_assistant_available_on_every_page_without_provider_calls(self):
        for path in ["#home", "#parameters/helpers", "#health", "#recipes", "#organize/devices", "#changes", "#settings"]:
            panel = self.panel(path)
            self.assertTrue(panel.is_visible())
            panel.get_by_role("button", name="Close assistant").click()
        self.assertEqual(self.asks, [])
        screenshot_dir = os.environ.get("TAXIS_SCREENSHOT_DIR")
        if screenshot_dir:
            self.panel()
            Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(screenshot_dir) / "ask-taxis.png"))


if __name__ == "__main__":
    unittest.main(testLoader=type("AssistantLoader", (unittest.TestLoader,), {"testMethodPrefix": "test_assistant_"})())
