"""Area codes relocation and data-preservation regressions.

Build the latest app and start the local mock, then run:
  TAXIS_TEST_URL=http://localhost:8099 python3 scripts/area-codes-browser.py
All writes are intercepted in Chromium. This never saves to HA or the mock DB.
"""
import copy
import json
import os
from pathlib import Path
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
        self.fixture["aggregationMarkers"] = {key: ("avg" if key in ["temperature", "humidity", "illuminance"] else "all") for key in ["lights", "motion", "presence", "door", "window", "temperature", "humidity", "illuminance", "media"]}
        self.current = copy.deepcopy(self.fixture)
        self.body = copy.deepcopy(self.hierarchy)
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
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=copy.deepcopy(self.body)))

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
        heading = "Area codes" if fragment == "#parameters/area-codes" else "Parameters" if fragment == "#parameters/helpers" else "Settings"
        self.page.get_by_role("heading", name=heading, exact=True).wait_for()

    def kitchen_code(self):
        return self.page.get_by_role("textbox", name="Code for Kitchen", exact=True)

    def test_mount_preserves_existing_values_and_does_not_save_or_queue_changes(self):
        self.open()
        self.assertEqual(self.kitchen_code().input_value(), "kitchen_custom")
        self.assertEqual(self.kitchen_code().get_attribute("placeholder"), "kitchen")
        self.assertEqual(self.page.get_by_role("textbox", name="Code for Living room", exact=True).input_value(), "")
        self.assertEqual(self.page.get_by_role("textbox", name="Code for Living room", exact=True).get_attribute("placeholder"), "living")
        self.assertEqual(self.page.locator("th[data-column-key='fit:Fit']").evaluate("e => getComputedStyle(e).textAlign"), "center")
        self.assertEqual(self.kitchen_code().locator("xpath=ancestor::tr").locator("td").nth(4).evaluate("e => getComputedStyle(e).textAlign"), "center")
        self.assertEqual(self.puts, [])
        self.assertEqual(self.current, self.fixture)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Settings", exact=True).click()
        self.assertEqual(self.page.get_by_role("heading", name="Area codes", exact=True).count(), 0)
        for heading in ("Patterns", "House light group", "Type words", "Aggregation markers"):
            self.page.get_by_role("heading", name=heading, exact=True).wait_for()
        self.assertEqual(self.page.get_by_role("heading", name="Floor codes", exact=True).count(), 0)
        self.assertEqual(self.page.get_by_role("textbox", name="Code for floor Ground floor", exact=True).count(), 0)
        self.assertEqual(self.page.get_by_label("Light group of the whole house", exact=True).input_value(), self.fixture["houseGroup"])
        self.assertEqual(self.puts, [])

    def test_saving_area_codes_preserves_every_other_naming_field(self):
        self.open()
        self.kitchen_code().fill("kitchen_saved")
        self.page.get_by_role("button", name="Save codes", exact=True).click()
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
        self.floor_code().fill("conflicted_floor")
        self.page.get_by_role("button", name="Save codes", exact=True).click()
        self.page.get_by_role("alert").filter(has_text="another session").wait_for()
        self.assertEqual(self.kitchen_code().input_value(), "conflicted_code")
        self.assertEqual(self.floor_code().input_value(), "conflicted_floor")
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

    def test_settings_default_reset_leaves_relocated_area_and_floor_codes_untouched(self):
        self.open("#settings")
        self.page.get_by_role("button", name="Back to defaults", exact=True).click()
        self.page.get_by_role("button", name="Save settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Saved in Taxis").wait_for()
        self.assertEqual(len(self.puts), 1)
        self.assertEqual(self.puts[0]["body"]["areaCodes"], self.fixture["areaCodes"])
        self.assertEqual(self.puts[0]["body"]["floorCodes"], self.fixture["floorCodes"])
        self.page.goto(BASE + "/#parameters/area-codes", wait_until="networkidle")
        self.assertEqual(self.floor_code().input_value(), self.fixture["floorCodes"]["ground"])
        self.assertEqual(self.kitchen_code().input_value(), self.fixture["areaCodes"]["kitchen"])

    def test_settings_save_keeps_relocated_codes_and_other_sections_editable(self):
        self.open("#settings")
        self.page.get_by_label("Display name", exact=True).fill("{Name} ({Area})")
        self.page.get_by_label("Light group of the whole house", exact=True).fill("home_lights")
        self.page.get_by_role("button", name="Save settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Saved in Taxis").wait_for()
        self.assertEqual(len(self.puts), 1)
        expected = {**self.fixture, "namePattern": "{Name} ({Area})", "houseGroup": "home_lights"}
        self.assertEqual(self.puts[0]["body"], expected)

    def test_legacy_helper_names_are_not_adopted_or_saved_on_open(self):
        self.fixture.pop("aggregationMarkers")
        self.current = copy.deepcopy(self.fixture)
        self.open("#settings")
        self.assertEqual(self.page.get_by_label("Word for Lights", exact=True).input_value(), "lamp")
        self.assertEqual(self.page.get_by_label("Aggregation marker for Lights", exact=True).input_value(), "all")
        self.assertEqual(self.page.get_by_label("Aggregation marker for Temperature", exact=True).input_value(), "avg")
        self.assertEqual(self.page.get_by_label("Word for Door", exact=True).get_attribute("placeholder"), "door")
        self.assertEqual(self.page.get_by_label("Word for Window", exact=True).get_attribute("placeholder"), "window")
        self.page.goto(BASE + "/#parameters/helpers", wait_until="networkidle")
        self.assertEqual(self.puts, [])
        self.assertEqual(self.current, self.fixture)

    def test_shared_type_words_and_markers_save_independently_and_reload(self):
        self.open("#settings")
        self.assertEqual(self.page.get_by_label("Word for Doors and windows", exact=True).count(), 0)
        self.page.get_by_label("Word for Door", exact=True).fill("entry")
        self.page.get_by_label("Word for Window", exact=True).fill("glazing")
        self.page.get_by_label("Aggregation marker for Doors", exact=True).fill("all")
        self.page.get_by_label("Word for Temperature", exact=True).fill("temperature")
        self.page.get_by_label("Aggregation marker for Temperature", exact=True).fill("mean")
        first_area = self.body["hierarchy"]["floors"][0]["areaIds"][0]
        self.page.get_by_text("binary_sensor." + first_area + "_entry_all", exact=True).wait_for()
        self.page.get_by_text("binary_sensor." + first_area + "_glazing_all", exact=True).wait_for()
        self.page.get_by_text("sensor." + first_area + "_temperature_mean", exact=True).wait_for()
        self.page.get_by_role("button", name="Save settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Saved in Taxis").wait_for()
        expected = {**self.fixture, "typeWords": {**self.fixture["typeWords"], "door": "entry", "window": "glazing", "temperature": "temperature"}, "aggregationMarkers": {**self.fixture["aggregationMarkers"], "temperature": "mean"}}
        self.assertEqual(self.puts[0]["body"], expected)
        self.page.reload(wait_until="networkidle")
        self.assertEqual(self.page.get_by_label("Word for Door", exact=True).input_value(), "entry")
        self.assertEqual(self.page.get_by_label("Word for Window", exact=True).input_value(), "glazing")
        self.assertEqual(self.page.get_by_label("Aggregation marker for Temperature", exact=True).input_value(), "mean")
        output = Path(os.environ.get("TAXIS_SCREENSHOT_DIR", "output/playwright"))
        output.mkdir(parents=True, exist_ok=True)
        self.page.get_by_role("heading", name="Aggregation markers", exact=True).scroll_into_view_if_needed()
        self.page.screenshot(path=str(output / "separate-helper-names.png"))

    def test_duplicate_or_invalid_shared_names_block_save_and_undo_restores_values(self):
        self.open("#settings")
        self.page.get_by_label("Word for Door", exact=True).fill("motion")
        save = self.page.get_by_role("button", name="Save settings", exact=True)
        self.assertTrue(save.is_disabled())
        self.page.get_by_label("Word for Door", exact=True).fill("entry")
        self.page.get_by_label("Aggregation marker for Doors", exact=True).fill("all_")
        self.assertTrue(save.is_disabled())
        self.page.get_by_role("button", name="Undo changes", exact=True).first.click()
        self.assertEqual(self.page.get_by_label("Word for Door", exact=True).input_value(), "")
        self.assertEqual(self.page.get_by_label("Aggregation marker for Doors", exact=True).input_value(), "all")
        self.assertTrue(save.is_enabled())
        self.assertEqual(self.puts, [])

    def helper_coverage_fixture(self):
        h = self.body["hierarchy"]
        base = copy.deepcopy(next(iter(h["entities"].values())))
        h["entities"], h["devices"] = {}, {}
        for area in h["areas"].values():
            area["entityIds"], area["deviceIds"] = [], []
        for entity_id, role, device_class, platform, members in [
            ("light.living_bulb", "light", None, "demo", []),
            ("light.living_lamp_all", "light", None, "group", ["light.living_bulb"]),
            ("binary_sensor.living_pir", "motion", "motion", "demo", []),
            ("binary_sensor.living_door", "opening", "door", "demo", []),
            ("binary_sensor.living_door_all", "opening", "door", "demo", []),
            ("binary_sensor.living_presence", "presence", "occupancy", "demo", []),
            ("binary_sensor.living_presence_all", "presence", "occupancy", "group", ["binary_sensor.missing_member"]),
            ("binary_sensor.living_window", "opening", "window", "demo", []),
            ("binary_sensor.living_old_windows", "opening", "window", "group", ["binary_sensor.living_window"]),
        ]:
            h["entities"][entity_id] = {**copy.deepcopy(base), "entityId": entity_id, "name": entity_id, "domain": entity_id.split(".")[0], "role": role, "deviceClass": device_class, "deviceClassOverride": None, "platform": platform, "members": members, "categoryScope": None, "areaId": "living_room", "ownAreaId": "living_room", "deviceId": None, "configEntryId": "fixture_" + entity_id if platform == "group" else None, "state": "off", "disabled": False, "hidden": False, "maintenance": False, "labels": [], "inRegistry": True}
        h["areas"]["living_room"]["entityIds"] = list(h["entities"])
        self.fixture["areaCodes"]["living_room"] = "living"
        self.current = copy.deepcopy(self.fixture)

    def coverage_row(self):
        table = self.page.get_by_role("table", name="Area helper coverage", exact=True)
        return table.locator("tbody tr").filter(has=self.page.get_by_role("button", name="Living room", exact=True))

    def test_helper_overview_shows_all_areas_and_distinguishes_actual_plan_states(self):
        self.helper_coverage_fixture()
        self.open("#parameters/helpers")
        table = self.page.get_by_role("table", name="Area helper coverage", exact=True)
        self.assertEqual(table.locator("tbody tr").count(), len(self.body["hierarchy"]["areas"]))
        row = self.coverage_row()
        for capability, expected_id, status in [
            ("Lights", "light.living_lamp_all", "Present"),
            ("Motion", "binary_sensor.living_motion_all", "Create"),
            ("Doors", "binary_sensor.living_door_all", "Conflict"),
            ("Presence", "binary_sensor.living_presence_all", "Update members"),
            ("Windows", "binary_sensor.living_window_all", "Adopt"),
        ]:
            details = row.get_by_label("Living room " + capability + " helper details", exact=True)
            self.assertIn(expected_id, details.inner_text())
            self.assertIn(status, details.inner_text())
        self.assertIn("Not needed", row.locator("td").nth(7).inner_text())
        self.assertIn("No helper in Taxis", row.locator("td").nth(10).inner_text())
        row.get_by_label("Living room Windows helper details", exact=True).click()
        row.get_by_text("binary_sensor.living_old_windows", exact=True).wait_for()
        output = Path(os.environ.get("TAXIS_SCREENSHOT_DIR", "output/playwright"))
        output.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(output / "helpers-coverage.png"))
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.assertEqual(self.puts, [])

    def test_helper_overview_shows_queued_as_queued_and_keeps_the_detailed_table(self):
        self.helper_coverage_fixture()
        pending = {"id": 999, "kind": "helper", "op": "create", "targetId": "binary_sensor.living_motion_all", "scope": "group", "before": None, "after": {"entity_id": "binary_sensor.living_motion_all", "entities": ["binary_sensor.living_pir"]}, "createdAt": "2026-10-27T00:00:00Z"}
        self.page.route("**/api/changes", lambda route: route.fulfill(json={"ok": True, "changes": [pending], "version": "fixture"}))
        self.open("#parameters/helpers")
        motion = self.coverage_row().get_by_label("Living room Motion helper details", exact=True)
        self.assertIn("In changes", motion.inner_text())
        self.assertNotIn("Present", motion.inner_text())
        self.page.get_by_role("tablist", name="Helper view", exact=True).get_by_role("tab", name="Details", exact=True).click()
        self.page.get_by_role("region", name="Floors and house", exact=True).wait_for()
        self.assertGreater(self.page.get_by_role("checkbox").count(), 0)
        self.page.get_by_role("tablist", name="Helper view", exact=True).get_by_role("tab", name="Overview", exact=True).click()
        self.page.get_by_role("table", name="Area helper coverage", exact=True).wait_for()
        self.assertEqual(self.puts, [])

    def test_helper_overview_uses_the_saved_capability_word_and_marker(self):
        self.helper_coverage_fixture()
        self.open("#settings")
        self.page.get_by_label("Word for Door", exact=True).fill("entry")
        self.page.get_by_label("Aggregation marker for Doors", exact=True).fill("all")
        self.page.get_by_role("button", name="Save settings", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Saved in Taxis").wait_for()
        self.page.goto(BASE + "/#parameters/helpers", wait_until="networkidle")
        door = self.coverage_row().get_by_label("Living room Doors helper details", exact=True)
        self.assertIn("binary_sensor.living_entry_all", door.inner_text())
        self.assertIn("Create", door.inner_text())
        self.assertEqual(len(self.puts), 1)

    def floor_code(self):
        return self.page.get_by_role("textbox", name="Code for floor Ground floor", exact=True)

    def test_floors_include_empty_floors_and_group_their_areas_even_after_sorting(self):
        h = self.body["hierarchy"]
        h["floors"].append({"id": "empty_floor", "name": "Empty floor", "level": 10, "icon": None, "areaIds": []})
        h["areas"]["detached_annex"] = {**copy.deepcopy(h["areas"]["kitchen"]), "id": "detached_annex", "name": "Detached annex", "floorId": None, "entityIds": [], "deviceIds": []}
        h["looseAreaIds"].append("detached_annex")
        self.open()
        table = self.page.get_by_role("table", name="Area and floor codes", exact=True)
        expected_groups = [floor["name"] for floor in h["floors"]] + ["No floor"]
        self.assertEqual(table.locator("tbody").evaluate_all("groups => groups.map(group => group.getAttribute('aria-label'))"), expected_groups)
        for floor in h["floors"]:
            group = table.get_by_role("rowgroup", name=floor["name"], exact=True)
            self.assertIn(floor["name"], group.locator("th[scope=rowgroup]").inner_text())
            self.assertEqual(group.locator(":scope > tr").count(), len(floor["areaIds"]) + 1)
            self.page.get_by_role("textbox", name="Code for floor " + floor["name"], exact=True).wait_for()
        loose = table.get_by_role("rowgroup", name="No floor", exact=True)
        self.assertIn("Detached annex", loose.inner_text())
        for key in ["area", "id", "found", "code", "fit"]:
            for _ in range(2):
                table.locator("thead th[data-column-key^='" + key + ":'] button").first.click()
                self.assertEqual(table.locator("tbody").evaluate_all("groups => groups.map(group => group.getAttribute('aria-label'))"), expected_groups)
                for floor in h["floors"]:
                    group = table.get_by_role("rowgroup", name=floor["name"], exact=True)
                    names = [h["areas"][area_id]["name"] for area_id in floor["areaIds"]]
                    self.assertCountEqual(group.locator("td:first-child button").all_text_contents(), names)
        output = Path(os.environ.get("TAXIS_SCREENSHOT_DIR", "output/playwright"))
        output.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(output / "area-codes-by-floor.png"), full_page=True)
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.assertEqual(self.puts, [])

    def test_floor_and_area_edits_save_together_and_preserve_other_settings(self):
        self.open()
        self.assertEqual(self.floor_code().input_value(), "ground_custom")
        self.assertEqual(self.floor_code().get_attribute("placeholder"), "ground")
        self.page.get_by_text("light.ground_custom_lamp_all", exact=True).wait_for()
        self.floor_code().fill("Ground Changed")
        self.kitchen_code().fill("kitchen_changed")
        self.assertEqual(self.floor_code().input_value(), "ground_changed")
        self.page.get_by_text("light.ground_changed_lamp_all", exact=True).wait_for()
        self.page.get_by_role("button", name="Save codes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Saved in Taxis").wait_for()
        expected = {**self.fixture, "areaCodes": {"kitchen": "kitchen_changed"}, "floorCodes": {"ground": "ground_changed"}}
        self.assertEqual(self.puts, [{"body": expected, "revision": "0"}])
        self.page.reload(wait_until="networkidle")
        self.assertEqual(self.floor_code().input_value(), "ground_changed")
        self.assertEqual(self.kitchen_code().input_value(), "kitchen_changed")

    def test_floor_only_draft_is_guarded_and_undo_and_reset_cover_both_code_maps(self):
        self.open()
        self.floor_code().fill("unsaved_floor")
        dialogs = []
        def dismiss(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()
        self.page.once("dialog", dismiss)
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Settings", exact=True).click()
        self.assertEqual(len(dialogs), 1)
        self.assertTrue(self.page.url.endswith("#parameters/area-codes"))
        self.page.get_by_role("button", name="Undo changes", exact=True).click()
        self.assertEqual(self.floor_code().input_value(), "ground_custom")
        self.page.get_by_role("button", name="Back to detected codes", exact=True).click()
        self.assertEqual(self.floor_code().input_value(), "")
        self.assertEqual(self.kitchen_code().input_value(), "")
        self.page.get_by_role("button", name="Undo changes", exact=True).click()
        self.assertEqual(self.floor_code().input_value(), "ground_custom")
        self.assertEqual(self.kitchen_code().input_value(), "kitchen_custom")
        self.assertEqual(self.puts, [])

    def test_duplicate_floor_codes_block_save_and_area_collisions_warn(self):
        self.open()
        self.floor_code().fill("first")
        self.floor_code().blur()
        self.assertEqual(self.floor_code().get_attribute("aria-invalid"), "true")
        self.assertTrue(self.page.get_by_role("button", name="Save codes", exact=True).is_disabled())
        self.page.get_by_role("alert").filter(has_text="Two floors share a code").wait_for()
        self.floor_code().fill("kitchen_custom")
        self.floor_code().blur()
        self.page.get_by_text("The area Kitchen has the same code", exact=False).wait_for()
        self.assertTrue(self.page.get_by_role("button", name="Save codes", exact=True).is_enabled())
        self.assertEqual(self.puts, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
