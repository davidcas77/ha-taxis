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
        panel.get_by_label("Your question").wait_for()
        panel.get_by_role("status").filter(has_text="Preparing context").wait_for(state="hidden")
        return panel

    def context_options(self, panel):
        button = panel.get_by_role("button", name="Assistant context", exact=True)
        if button.get_attribute("aria-expanded") != "true":
            button.click()
        return panel.get_by_role("region", name="Assistant context options")

    def test_assistant_open_is_local_and_only_send_calls_a_provider(self):
        panel = self.panel()
        self.assertEqual(self.asks, [])
        self.assertEqual(panel.get_by_role("checkbox").count(), 0)
        self.assertFalse(panel.get_by_role("button", name="AI administration", exact=True).is_visible())
        options = self.context_options(panel)
        self.assertFalse(options.get_by_role("checkbox", name="Include page data").is_checked())
        self.assertEqual(options.get_by_label("Assistant area").input_value(), "living_room")
        panel.get_by_label("Your question").fill("Explain this room")
        panel.locator("summary").click()
        self.assertIn('"page only"', panel.get_by_label("Assistant context preview").inner_text())
        self.assertEqual(self.asks, [])
        panel.get_by_role("button", name="Send message", exact=True).click()
        panel.get_by_text(self.reply, exact=True).wait_for()
        self.assertEqual(self.asks[0]["history"], [])
        self.assertFalse(self.asks[0]["includeData"])
        self.assertEqual(self.posts + self.puts, [])

    def test_assistant_actions_route_and_history_is_visible(self):
        panel = self.panel()
        for action, label in [("next", "Suggest next steps"), ("naming", "Naming help"), ("explain", "Explain")]:
            panel.get_by_label("Assistant task", exact=True).select_option(action)
            panel.get_by_label("Your question").fill(label)
            panel.get_by_role("button", name="Send message", exact=True).click()
            panel.get_by_text(self.reply, exact=True).last.wait_for()
            self.assertEqual(self.asks[-1]["action"], action)
        self.assertEqual(len(self.asks[-1]["history"]), 4)
        panel.get_by_role("button", name="Assistant options", exact=True).click()
        panel.get_by_role("button", name="Clear chat", exact=True).click()
        self.assertEqual(panel.get_by_role("log").inner_text(), "")

    def test_assistant_scope_change_clears_conversation_and_keeps_preview_available(self):
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        panel.get_by_role("button", name="Send message", exact=True).click()
        panel.get_by_text(self.reply, exact=True).wait_for()
        self.context_options(panel).get_by_role("checkbox", name="Include page data").check()
        panel.get_by_role("status").filter(has_text="Preparing context").wait_for(state="hidden")
        panel.get_by_text("Review exactly what will be sent", exact=False).wait_for()
        panel.get_by_role("button", name="Back to chat", exact=True).click()
        self.assertEqual(panel.get_by_role("log").inner_text(), "")
        self.assertTrue(self.previews[-1]["includeData"])

    def test_assistant_error_preserves_question_and_never_queues_changes(self):
        self.fail_ask = True
        panel = self.panel()
        panel.get_by_label("Your question").fill("Why is this helper missing?")
        panel.get_by_role("button", name="Send message", exact=True).click()
        panel.get_by_role("alert").wait_for()
        self.assertEqual(panel.get_by_label("Your question").input_value(), "Why is this helper missing?")
        self.assertEqual(self.posts + self.puts, [])
        self.assertTrue(panel.get_by_role("button", name="Refresh context", exact=True).is_visible())

    def test_assistant_off_has_setup_path_and_no_paid_call(self):
        self.ai["enabled"] = False
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        self.assertTrue(panel.get_by_role("button", name="Send message", exact=True).is_disabled())
        panel.get_by_text("AI is off.", exact=False).wait_for()
        self.assertEqual(self.asks, [])

    def test_assistant_text_cannot_render_html_or_execute_an_action(self):
        self.reply = '<img src=x onerror="alert(1)"> Apply all changes'
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        panel.get_by_role("button", name="Send message", exact=True).click()
        panel.get_by_text(self.reply, exact=True).wait_for()
        self.assertEqual(panel.get_by_role("log").locator("img,script").count(), 0)
        self.assertEqual(self.posts + self.puts, [])

    def test_assistant_mobile_fit_escape_and_focus_return(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        panel = self.panel()
        self.assertLessEqual(panel.bounding_box()["width"], 390)
        self.assertLess(panel.bounding_box()["height"], 844 * 0.65)
        self.assertGreater(panel.bounding_box()["x"], 0)
        self.assertGreater(panel.bounding_box()["y"], 0)
        self.assertFalse(self.page.evaluate("document.documentElement.scrollWidth > window.innerWidth"))
        screenshot_dir = os.environ.get("TAXIS_SCREENSHOT_DIR")
        if screenshot_dir:
            Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(screenshot_dir) / "ask-taxis-mobile.png"))
        panel.get_by_role("button", name="Close assistant").focus()
        self.page.keyboard.press("Escape")
        self.assertEqual(panel.count(), 0)
        self.assertTrue(self.page.get_by_role("button", name="Ask Taxis", exact=True).evaluate("e => e === document.activeElement"))

    def test_assistant_admin_lists_functions_triggers_boundaries_and_no_requests(self):
        self.page.goto(fixture.BASE + "/#settings/ai", wait_until="networkidle")
        self.page.get_by_role("heading", name="AI administration", exact=True).wait_for()
        table = self.page.get_by_role("table", name="AI functions")
        for text in ["Explain", "Suggest next steps", "Naming help", "Room-note review", "Text advice only"]:
            self.assertIn(text, table.inner_text())
        self.assertEqual(self.asks, [])
        self.assertEqual(self.previews, [])
        # The model and key settings share this tab, so there is no separate page to open.
        self.assertTrue(self.page.locator("section[aria-labelledby='ai-heading']").is_visible())
        self.assertTrue(self.page.get_by_label("Strong model", exact=True).is_visible())

    def test_assistant_late_reply_cannot_appear_after_navigation(self):
        self.hold = True
        panel = self.panel()
        panel.get_by_role("button", name="Explain", exact=True).click()
        panel.get_by_role("button", name="Send message", exact=True).click()
        self.page.wait_for_timeout(150)
        self.assertIsNotNone(self.held)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Settings", exact=True).click()
        self.page.get_by_role("tab", name="AI", exact=True).click()
        # The route changes on hashchange; release the reply only once it has.
        self.page.wait_for_function("location.hash === '#settings/ai'")
        self.held.fulfill(json=self.answer())
        panel.get_by_role("status").filter(has_text="Preparing context").wait_for(state="hidden")
        # The context for the new page is prepared after the route change, which a
        # slow runner may not have reached yet: give it up to five seconds.
        for _ in range(50):
            if self.previews and self.previews[-1]["page"] == "ai-admin":
                break
            self.page.wait_for_timeout(100)
        self.assertEqual(self.previews[-1]["page"], "ai-admin")
        self.assertEqual(panel.get_by_role("log").inner_text(), "")

    def test_assistant_available_on_every_page_without_provider_calls(self):
        for path in ["#home", "#parameters/helpers", "#health", "#automations/recipes", "#automations/buttons", "#organize/devices", "#changes", "#settings", "#settings/ai"]:
            panel = self.panel(path)
            self.assertTrue(panel.is_visible())
            panel.get_by_role("button", name="Close assistant").click()
        self.assertEqual(self.asks, [])
        screenshot_dir = os.environ.get("TAXIS_SCREENSHOT_DIR")
        if screenshot_dir:
            self.panel()
            Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(screenshot_dir) / "ask-taxis.png"))
            self.page.get_by_role("dialog", name="Ask Taxis assistant").screenshot(path=str(Path(screenshot_dir) / "ask-taxis-window.png"))

    def test_assistant_floats_at_half_height_without_changing_page_width(self):
        self.page.goto(fixture.BASE + "/#home", wait_until="networkidle")
        main = self.page.get_by_role("main")
        before = main.bounding_box()
        self.page.get_by_role("button", name="Ask Taxis", exact=True).click()
        panel = self.page.get_by_role("dialog", name="Ask Taxis assistant")
        bounds = panel.bounding_box()
        self.assertEqual(main.bounding_box(), before)
        self.assertLessEqual(bounds["height"], 1100 * 0.56)
        self.assertGreaterEqual(bounds["height"], 1100 * 0.4)
        self.assertGreater(bounds["x"], 0)
        self.assertGreater(bounds["y"], 0)
        self.assertLess(bounds["x"] + bounds["width"], 1600)
        self.assertLess(bounds["y"] + bounds["height"], 1100)
        self.assertTrue(panel.get_by_role("button", name="Send message").is_visible())

    def test_assistant_enter_sends_shift_enter_adds_newline_and_options_stay_compact(self):
        panel = self.panel()
        question = panel.get_by_label("Your question")
        question.fill("Explain this room")
        question.press("Shift+Enter")
        self.assertIn("\n", question.input_value())
        self.assertEqual(self.asks, [])
        question.press("Enter")
        panel.get_by_text(self.reply, exact=True).wait_for()
        panel.get_by_role("button", name="Assistant options", exact=True).click()
        options = panel.get_by_role("region", name="Assistant options", exact=True)
        self.assertTrue(options.get_by_role("button", name="AI administration", exact=True).is_visible())
        self.assertIn("middle", options.inner_text())
        options.get_by_role("button", name="Clear chat", exact=True).focus()
        self.page.keyboard.press("Escape")
        self.assertTrue(panel.is_visible())
        self.assertEqual(options.count(), 0)
        self.assertTrue(panel.get_by_role("button", name="Assistant options", exact=True).evaluate("e => e === document.activeElement"))
        self.page.keyboard.press("Escape")
        self.assertEqual(panel.count(), 0)

    def test_assistant_long_reply_scrolls_without_moving_the_composer(self):
        self.reply = ("Check the existing room sensors before adding equipment.\n" * 120)
        panel = self.panel()
        composer = panel.get_by_label("Your question")
        before = composer.bounding_box()
        composer.fill("Explain this room")
        composer.press("Enter")
        panel.get_by_role("log").get_by_text(self.reply, exact=True).wait_for()
        self.assertEqual(composer.bounding_box(), before)
        self.assertTrue(panel.get_by_role("button", name="Send message").is_visible())

    def test_assistant_short_viewport_keeps_the_window_and_send_box_inside(self):
        self.page.set_viewport_size({"width": 700, "height": 360})
        panel = self.panel()
        bounds = panel.bounding_box()
        self.assertGreaterEqual(bounds["y"], 0)
        self.assertLessEqual(bounds["y"] + bounds["height"], 360)
        send = panel.get_by_role("button", name="Send message").bounding_box()
        self.assertGreaterEqual(send["y"], bounds["y"])
        self.assertLessEqual(send["y"] + send["height"], bounds["y"] + bounds["height"])


if __name__ == "__main__":
    unittest.main(testLoader=type("AssistantLoader", (unittest.TestLoader,), {"testMethodPrefix": "test_assistant_"})())
