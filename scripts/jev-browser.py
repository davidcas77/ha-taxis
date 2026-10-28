"""Jev settings and room-note review. Dummy HA only; every write is intercepted."""
import copy
import importlib.util
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("guide_fixture", Path(__file__).with_name("guide-browser.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
KEY = "jev-browser-fixture-not-a-real-key"


class JevRegression(fixture.GuideRegression):
    def setUp(self):
        super().setUp()
        self.jev = {"enabled": False, "model": "jev-1.14.0", "monthlyRequestLimit": 100, "keySet": False}
        self.jev_revision = 0
        self.jev_puts, self.jev_tests, self.jev_reviews = [], [], []
        self.jev_conflict, self.review_failure, self.hold_review = False, False, False
        self.held_review = None

        def settings(route):
            if route.request.method == "PUT":
                body = route.request.post_data_json
                self.jev_puts.append({"body": body, "revision": route.request.headers.get("if-match")})
                if self.jev_conflict:
                    route.fulfill(status=409, json={"ok": False, "error": "These settings changed in another session. Reload before saving."})
                    return
                for key in ["enabled", "model", "monthlyRequestLimit"]:
                    self.jev[key] = body[key]
                if "key" in body:
                    self.jev["keySet"] = body["key"] is not None
                self.jev_revision += 1
            route.fulfill(json={"ok": True, "jev": copy.deepcopy(self.jev), "revision": str(self.jev_revision)})
        self.page.route("**/api/settings/jev", settings)
        self.page.route("**/api/jev/usage", lambda route: route.fulfill(json={"ok": True, "usage": {"month": "2026-10", "limit": self.jev["monthlyRequestLimit"], "attempts": len(self.jev_tests) + len(self.jev_reviews), "completed": len(self.jev_tests), "inputTokens": 100 * len(self.jev_tests), "outputTokens": 20 * len(self.jev_tests), "estimatedUsd": 0.0000042 * len(self.jev_tests), "unknownUsage": 0}}))

        def test(route):
            self.jev_tests.append(route.request.post_data_json)
            route.fulfill(json={"ok": True, "model": self.jev["model"], "inputTokens": 100, "outputTokens": 20, "estimatedUsd": 0.0000042})
        self.page.route("**/api/jev/test", test)

        def review(route):
            self.jev_reviews.append(route.request.post_data_json)
            if self.hold_review:
                self.held_review = route
            elif self.review_failure:
                route.fulfill(status=429, json={"ok": False, "error": "The monthly Jev request limit has been reached."})
            else:
                route.fulfill(json=self.review_body(route.request.post_data_json))
        self.page.route("**/api/jev/room-notes", review)

    def review_body(self, body):
        def answer(key):
            bad = key == "still"
            return {"choice": "problem" if bad else "not_observed", "confidence": 0.9, "probabilities": {"positive": 0.05, "problem": 0.9 if bad else 0.05, "not_observed": 0.05 if bad else 0.9}}
        return {"ok": True, "review": {"model": self.jev["model"], "policyVersion": "room-notes-v1", "answers": {key: answer(key) for key in body["checks"]}, "inputTokens": 100, "outputTokens": 20, "estimatedUsd": 0.0000042}}

    def settings(self):
        self.page.goto(fixture.BASE + "/#settings", wait_until="networkidle")
        section = self.page.get_by_role("region", name="Jev decisions", exact=True)
        section.get_by_label("Jev API key", exact=True).wait_for()
        return section

    def configure(self):
        section = self.settings()
        section.get_by_role("checkbox", name="Enable Jev decisions", exact=True).check()
        section.get_by_label("Jev API key", exact=True).fill(KEY)
        section.get_by_role("button", name="Save Jev settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Jev settings saved").wait_for()
        return section

    def test_jev_key_is_write_only_save_and_test_use_the_selected_model(self):
        section = self.settings()
        self.assertEqual(section.get_by_label("Jev API key", exact=True).get_attribute("type"), "password")
        self.assertEqual(self.jev_puts + self.jev_tests + self.jev_reviews, [])
        section.get_by_role("checkbox", name="Enable Jev decisions", exact=True).check()
        section.get_by_label("Jev model", exact=True).select_option("jev-1.13.0")
        section.get_by_label("Monthly Jev request limit", exact=True).fill("12")
        section.get_by_label("Jev API key", exact=True).fill(KEY)
        self.assertTrue(section.get_by_role("button", name="Test Jev connection", exact=True).is_disabled())
        section.get_by_role("button", name="Save Jev settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Jev settings saved").wait_for()
        self.assertEqual(self.jev_puts[0], {"body": {"enabled": True, "model": "jev-1.13.0", "monthlyRequestLimit": 12, "key": KEY}, "revision": "0"})
        self.assertNotIn(KEY, self.page.content())
        self.assertNotIn(KEY, self.page.evaluate("JSON.stringify([localStorage, sessionStorage])"))
        self.assertEqual(section.get_by_label("Jev API key", exact=True).count(), 0)
        section.get_by_role("button", name="Test Jev connection", exact=True).click()
        section.get_by_role("status").filter(has_text="Connected · jev-1.13.0").wait_for()
        self.assertEqual(self.jev_tests, [{}])
        self.assertEqual(self.puts + self.posts, [])

    def test_jev_replace_remove_and_undo_preserve_other_settings(self):
        section = self.configure()
        section.get_by_role("button", name="Replace Jev key", exact=True).click()
        section.get_by_label("Jev API key", exact=True).fill("jev-replacement-fixture")
        section.get_by_role("button", name="Save Jev settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Jev settings saved").wait_for()
        section.get_by_role("button", name="Remove Jev key", exact=True).click()
        self.assertTrue(section.get_by_role("button", name="Test Jev connection", exact=True).is_disabled())
        section.get_by_role("button", name="Undo Jev changes", exact=True).click()
        self.assertTrue(self.jev["keySet"])
        self.assertEqual(len(self.jev_puts), 2)
        section.get_by_role("button", name="Remove Jev key", exact=True).click()
        section.get_by_role("button", name="Save Jev settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Jev settings saved").wait_for()
        self.assertIsNone(self.jev_puts[-1]["body"]["key"])
        self.assertFalse(self.jev["keySet"])
        self.assertEqual(self.puts + self.posts + self.jev_tests, [])

    def test_jev_stale_save_retains_the_masked_draft_and_blocks_unsaved_test(self):
        section = self.settings()
        self.jev_conflict = True
        section.get_by_label("Jev API key", exact=True).fill(KEY)
        section.get_by_role("button", name="Save Jev settings", exact=True).click()
        section.get_by_role("alert").filter(has_text="changed in another session").wait_for()
        self.assertEqual(section.get_by_label("Jev API key", exact=True).input_value(), KEY)
        self.assertTrue(section.get_by_role("button", name="Test Jev connection", exact=True).is_disabled())
        self.assertFalse(self.jev["keySet"])
        self.assertEqual(self.jev_tests, [])

    def test_jev_settings_shortcut_scrolls_to_the_key_field(self):
        section = self.settings()
        self.page.get_by_role("navigation", name="Settings sections", exact=True).get_by_role("button", name="Jev decisions", exact=True).click()
        box = section.get_by_label("Jev API key", exact=True).bounding_box()
        self.assertGreaterEqual(box["y"], 0)
        self.assertLess(box["y"], self.page.viewport_size["height"])
        output = Path(os.environ.get("TAXIS_SCREENSHOT_DIR", "output/playwright"))
        output.mkdir(parents=True, exist_ok=True)
        section.screenshot(path=str(output / "jev-settings.png"))
        self.assertEqual(self.jev_puts + self.jev_tests + self.jev_reviews, [])

    def test_jev_unsaved_key_navigation_is_guarded_and_mobile_fits(self):
        section = self.settings()
        section.get_by_label("Jev API key", exact=True).fill(KEY)
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        section.get_by_role("button", name="Reload Jev settings", exact=True).click()
        self.assertEqual(section.get_by_label("Jev API key", exact=True).input_value(), KEY)
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.assertEqual(self.jev_puts + self.jev_tests + self.posts, [])

    def test_jev_review_is_manual_advisory_and_never_saves_or_checks_observations(self):
        self.jev.update({"enabled": True, "keySet": True})
        checks = self.ready_room()
        checks.get_by_label("Room test notes", exact=True).fill("The lights still go off while I sit and read.")
        review = checks.get_by_role("region", name="Jev room-note review", exact=True)
        self.assertEqual(self.jev_reviews, [])
        review.get_by_role("button", name="Review notes with Jev", exact=True).click()
        review.get_by_text("Notes suggest a problem", exact=False).wait_for()
        self.assertEqual(set(self.jev_reviews[0]), {"notes", "checks"})
        self.assertEqual(self.jev_reviews[0]["checks"], ["entry", "still", "pause"])
        self.assertFalse(any(c.is_checked() for c in checks.get_by_role("checkbox").all()))
        self.assertEqual(self.puts + self.posts, [])
        checks.get_by_label("Room test notes", exact=True).fill("Changed observations.")
        self.assertEqual(review.get_by_text("Notes suggest a problem", exact=False).count(), 0)

    def test_jev_failure_keeps_room_notes_and_checks_untouched(self):
        self.jev.update({"enabled": True, "keySet": True})
        self.review_failure = True
        checks = self.ready_room()
        checks.get_by_role("checkbox").first.check()
        checks.get_by_label("Room test notes", exact=True).fill("Keep these notes.")
        review = checks.get_by_role("region", name="Jev room-note review", exact=True)
        review.get_by_role("button", name="Review notes with Jev", exact=True).click()
        review.get_by_role("alert").filter(has_text="limit has been reached").wait_for()
        self.assertTrue(checks.get_by_role("checkbox").first.is_checked())
        self.assertEqual(checks.get_by_label("Room test notes", exact=True).input_value(), "Keep these notes.")
        self.assertEqual(self.puts + self.posts, [])

    def test_jev_inflight_response_is_ignored_after_the_notes_change(self):
        self.jev.update({"enabled": True, "keySet": True})
        self.hold_review = True
        checks = self.ready_room()
        checks.get_by_label("Room test notes", exact=True).fill("Old observation: lights go off.")
        review = checks.get_by_role("region", name="Jev room-note review", exact=True)
        with self.page.expect_request("**/api/jev/room-notes"):
            review.get_by_role("button", name="Review notes with Jev", exact=True).click()
        checks.get_by_label("Room test notes", exact=True).fill("New observation: testing a different issue.")
        self.held_review.fulfill(json=self.review_body(self.jev_reviews[0]))
        review.get_by_role("button", name="Review notes with Jev", exact=True).wait_for()
        self.assertEqual(review.get_by_text("Notes suggest a problem", exact=False).count(), 0)
        self.assertEqual(checks.get_by_label("Room test notes", exact=True).input_value(), "New observation: testing a different issue.")
        self.assertEqual(self.puts + self.posts, [])


if __name__ == "__main__":
    loader = unittest.TestLoader()
    loader.testMethodPrefix = "test_jev_"
    unittest.main(testLoader=loader, verbosity=2)
