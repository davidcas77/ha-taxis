"""Area codes relocation and data-preservation regressions.

Build the latest app and start the local mock, then run:
  TAXIS_TEST_URL=http://localhost:8099 python3 scripts/area-codes-browser.py
All writes are intercepted in Chromium. This never saves to HA or the mock DB.
"""
import copy
import json
import os
import unittest
import urllib.request
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:8099")


class AreaCodesRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            cls.hierarchy = json.load(response)
        with urllib.request.urlopen(BASE + "/api/settings/naming", timeout=30) as response:
            cls.naming = json.load(response)["naming"]
        if not cls.hierarchy.get("ok") or "kitchen" not in cls.hierarchy["hierarchy"]["areas"]:
            raise RuntimeError("Run against the documented mock house, not a live HA instance")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1100})
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.fixture = copy.deepcopy(self.naming)
        self.fixture.update({"idPattern": "{area}_{name}_{type}", "namePattern": "{Name} in {Area}", "areaCodes": {"kitchen": "kitchen_custom"}, "floorCodes": {"ground": "ground_custom"}, "houseGroup": "whole_home", "typeWords": {"light": "lamp"}, "helperNames": {"lights": "lighting"}})
        self.current = copy.deepcopy(self.fixture)
        self.puts = []
        self.unexpected_writes = []
        self.fail_save = False
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

        def read_only(route):
            if route.request.method not in ("GET", "HEAD"):
                self.unexpected_writes.append((route.request.method, urlsplit(route.request.url).path))
                route.fulfill(status=409, json={"ok": False, "error": "This regression never writes to HA"})
            else:
                route.continue_()
        self.page.route("**/api/**", read_only)
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=copy.deepcopy(self.hierarchy)))

        def naming(route):
            if route.request.method == "PUT":
                self.puts.append({"body": route.request.post_data_json, "revision": route.request.headers.get("if-match")})
                if self.fail_save:
                    route.fulfill(status=409, json={"ok": False, "error": "These settings changed in another session. Reload the settings before saving again."})
                    return
                self.current = copy.deepcopy(route.request.post_data_json)
            route.fulfill(json={"ok": True, "naming": self.current, "revision": str(len(self.puts))})
        self.page.route("**/api/settings/naming", naming)

    def tearDown(self):
        self.assertEqual(self.unexpected_writes, [])
        self.assertEqual(self.errors, [])
        self.context.close()

    def open(self, fragment="#parameters/area-codes"):
        self.page.goto(BASE + "/" + fragment, wait_until="networkidle")
        self.page.get_by_role("heading", name="Area codes" if fragment == "#parameters/area-codes" else "Settings", exact=True).wait_for()

    def kitchen_code(self):
        return self.page.get_by_role("textbox", name="Code for Kitchen", exact=True)

    def test_mount_preserves_existing_values_and_does_not_save_or_queue_changes(self):
        self.open()
        self.assertEqual(self.kitchen_code().input_value(), "kitchen_custom")
        self.assertEqual(self.kitchen_code().get_attribute("placeholder"), "kitchen")
        self.assertEqual(self.page.get_by_role("textbox", name="Code for Living room", exact=True).input_value(), "")
        self.assertEqual(self.page.get_by_role("textbox", name="Code for Living room", exact=True).get_attribute("placeholder"), "living")
        self.assertEqual(self.page.locator("th[data-column-key='fit:Fit']").evaluate("e => getComputedStyle(e).textAlign"), "center")
        self.assertEqual(self.page.locator("tbody tr").first.locator("td").nth(4).evaluate("e => getComputedStyle(e).textAlign"), "center")
        self.assertEqual(self.puts, [])
        self.assertEqual(self.current, self.fixture)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Settings", exact=True).click()
        self.assertEqual(self.page.get_by_role("heading", name="Area codes", exact=True).count(), 0)
        for heading in ("Patterns", "Floor codes", "Type words", "Helper names"):
            self.page.get_by_role("heading", name=heading, exact=True).wait_for()
        self.assertEqual(self.puts, [])

    def test_saving_area_codes_preserves_every_other_naming_field(self):
        self.open()
        self.kitchen_code().fill("kitchen_saved")
        self.page.get_by_role("button", name="Save area codes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Saved in Taxis").wait_for()
        self.assertEqual(len(self.puts), 1)
        expected = {**self.fixture, "areaCodes": {"kitchen": "kitchen_saved"}}
        self.assertEqual(self.puts[0], {"body": expected, "revision": "0"})
        self.assertEqual(self.current, expected)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Settings", exact=True).click()
        self.assertTrue(self.page.url.endswith("#settings"))
        self.assertEqual(self.page.get_by_label("Entity id", exact=True).input_value(), self.fixture["idPattern"])

    def test_dirty_guard_cancel_and_undo_preserve_original_codes(self):
        self.open()
        self.kitchen_code().fill("unsaved_code")
        dialogs = []
        def dismiss(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()
        self.page.once("dialog", dismiss)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Settings", exact=True).click()
        self.assertEqual(len(dialogs), 1)
        self.assertIn("Discard", dialogs[0])
        self.assertTrue(self.page.url.endswith("#parameters/area-codes"))
        self.assertEqual(self.kitchen_code().input_value(), "unsaved_code")
        self.page.get_by_role("button", name="Undo changes", exact=True).click()
        self.assertEqual(self.kitchen_code().input_value(), "kitchen_custom")
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Settings", exact=True).click()
        self.assertTrue(self.page.url.endswith("#settings"))
        self.assertEqual(self.puts, [])

    def test_revision_conflict_keeps_draft_without_retry_or_other_writes(self):
        self.fail_save = True
        self.open()
        self.kitchen_code().fill("conflicted_code")
        self.page.get_by_role("button", name="Save area codes", exact=True).click()
        self.page.get_by_role("alert").filter(has_text="another session").wait_for()
        self.assertEqual(self.kitchen_code().input_value(), "conflicted_code")
        self.assertEqual(len(self.puts), 1)
        self.assertEqual(self.current, self.fixture)

    def test_naming_navigation_links_open_the_relocated_tab(self):
        self.open()
        self.page.goto(BASE + "/#area/kitchen/naming", wait_until="networkidle")
        self.page.get_by_role("button", name="change in Parameters", exact=True).click()
        self.assertTrue(self.page.url.endswith("#parameters/area-codes"))
        self.page.get_by_role("heading", name="Area codes", exact=True).wait_for()
        self.page.goto(BASE + "/#organize/spaces/area%3Akitchen", wait_until="networkidle")
        self.page.get_by_role("button", name="Go to Parameters to change", exact=True).click()
        self.assertTrue(self.page.url.endswith("#parameters/area-codes"))
        self.assertEqual(self.puts, [])

    def test_settings_default_reset_leaves_relocated_area_codes_untouched(self):
        self.open("#settings")
        self.page.get_by_role("button", name="Back to defaults", exact=True).click()
        self.page.get_by_role("button", name="Save settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Saved in Taxis").wait_for()
        self.assertEqual(len(self.puts), 1)
        self.assertEqual(self.puts[0]["body"]["areaCodes"], self.fixture["areaCodes"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
