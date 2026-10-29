"""Read-only Unassigned view browser regressions; all writes are intercepted.

Run against npm run dev:mock: python3 scripts/unassigned-browser.py
"""
import copy
import json
import os
import re
import unittest
import urllib.request
from playwright.sync_api import sync_playwright
from browser_common import BASE, launch, screenshot_dir



class UnassignedRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            cls.base = json.load(response)
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1100})
        self.page = self.context.new_page()
        self.page.set_default_timeout(60000)
        self.page.set_default_navigation_timeout(60000)
        self.body = copy.deepcopy(self.base)
        h = self.body["hierarchy"]
        template = next(iter(h["entities"].values()))
        h["entities"] = {}
        h["unassignedEntityIds"] = []
        device_base = copy.deepcopy(next(iter(h["devices"].values())))
        h["devices"] = {"fixture_device": {**device_base, "id": "fixture_device", "name": "Unplaced fixture bridge", "areaId": None, "disabled": False, "entityIds": []}}
        for device_id, name, disabled, area in [("empty_device", "Empty service fixture", False, None), ("disabled_device", "Disabled fixture", True, None), ("placed_device", "Placed fixture", False, next(iter(h["areas"])) )]:
            h["devices"][device_id] = {**device_base, "id": device_id, "name": name, "areaId": area, "disabled": disabled, "isService": device_id == "empty_device", "entityIds": []}
        for i in range(451):
            entity_id = f"sensor.unplaced_{i:03}"
            h["entities"][entity_id] = {**template, "entityId": entity_id, "name": f"Unplaced {i:03}", "domain": "sensor", "role": "sensor", "areaId": None, "ownAreaId": None, "deviceId": "fixture_device" if i < 3 else None, "members": [], "inRegistry": i != 2, "needsOwnName": i == 1, "customName": None, "disabled": False, "hidden": False, "maintenance": False}
            h["unassignedEntityIds"].append(entity_id)
        self.area = next(iter(h["areas"]))
        self.override_area = next(a for a in h["areas"] if a != self.area)
        h["entities"]["sensor.fixed_area"] = {**h["entities"]["sensor.unplaced_003"], "entityId": "sensor.fixed_area", "name": "Fixed area fixture", "deviceId": "fixture_device", "areaId": self.override_area, "ownAreaId": self.override_area}
        h["devices"]["fixture_device"]["entityIds"] = ["sensor.unplaced_000", "sensor.unplaced_001", "sensor.unplaced_002", "sensor.fixed_area"]
        self.posted = []
        self.queue = []
        self.errors, self.unexpected = [], []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        def guard(route):
            if route.request.method in ["GET", "HEAD"]:
                route.continue_()
            else:
                self.unexpected.append(route.request.url)
                route.fulfill(status=409, json={"ok": False, "error": "Unexpected write blocked"})
        self.page.route("**/api/**", guard)
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=self.body))
        def changes(route):
            if route.request.method == "POST":
                body = route.request.post_data_json
                # One edit goes to /api/changes; several (a bulk move) go in one request to /api/changes/batch.
                for value in body["changes"] if "changes" in body else [body]:
                    self.posted.append(value)
                    if value["kind"] == "device":
                        h["devices"][value["targetId"]]["areaId"] = value["fields"]["area_id"]
                    elif value["kind"] == "entity":
                        h["entities"][value["targetId"]]["ownAreaId"] = value["fields"].get("area_id")
                    for e in h["entities"].values():
                        e["areaId"] = e["ownAreaId"] if e["ownAreaId"] is not None else h["devices"].get(e["deviceId"], {}).get("areaId")
                    h["unassignedEntityIds"] = [e["entityId"] for e in h["entities"].values() if e["areaId"] is None]
                    self.queue.append({"id": len(self.queue) + 1, "kind": value["kind"], "op": value["op"], "targetId": value["targetId"], "scope": None, "before": {}, "after": value["fields"], "createdAt": "2026-10-27T00:00:00Z"})
            route.fulfill(json={"ok": True, "changes": self.queue, "version": str(len(self.queue))})
        self.page.route("**/api/changes", changes)
        self.page.route("**/api/changes/batch", changes)
        self.page.goto(BASE + "/#unassigned", wait_until="domcontentloaded")
        self.open_entities()
        self.section = self.page.get_by_role("region", name="Unassigned entities", exact=True)
        self.section.get_by_role("textbox", name="Find unassigned entities").wait_for()

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors + self.unexpected, [])

    def open_entities(self):
        self.page.get_by_role("tab", name=re.compile(r"^Entities \(")).click()

    def table(self):
        self.open_entities()
        self.section.get_by_role("button", name="Table", exact=True).click()
        return self.section.get_by_role("table", name="Unassigned entities table")

    def assert_compact_table_toolbar(self, region, table_label, search_label, bulk_label, action_label):
        table = region.get_by_role("table", name=table_label, exact=True)
        wrapper = table.locator("xpath=ancestor::*[@data-table-id][1]")
        toolbar = wrapper.get_by_role("toolbar", name="Table controls for " + table_label, exact=True)
        search = toolbar.get_by_role("textbox", name=search_label, exact=True)
        bulk = toolbar.get_by_role("region", name=bulk_label, exact=True)
        action = bulk.get_by_role("button", name=action_label, exact=True)
        chooser = toolbar.get_by_role("button", name="Columns of " + table_label, exact=True)
        centers = [locator.bounding_box()["y"] + locator.bounding_box()["height"] / 2 for locator in [search, action, chooser]]
        self.assertLessEqual(max(centers) - min(centers), 2)
        self.assertGreater(action.bounding_box()["x"], search.bounding_box()["x"] + search.bounding_box()["width"])
        self.assertGreater(chooser.bounding_box()["x"], action.bounding_box()["x"] + action.bounding_box()["width"])
        self.assertEqual(region.get_by_role("textbox", name=search_label, exact=True).count(), 1)
        self.assertTrue(table.evaluate("table => {const frame=table.parentElement.parentElement; return !frame.contains(table.closest('[data-table-id]').querySelector('[role=toolbar]'));}"))
        self.assertGreater(table.locator("tr").first.locator("th").count(), 0)
        self.assertEqual(table.locator("tr").first.locator("td").count(), 0)
        self.assertLessEqual(toolbar.bounding_box()["y"] + toolbar.bounding_box()["height"], table.bounding_box()["y"] + 1)
        return toolbar

    def test_search_batch_actions_and_columns_share_one_external_table_toolbar(self):
        self.page.reload(wait_until="domcontentloaded")
        devices = self.page.get_by_role("region", name="Unassigned devices", exact=True)
        devices.get_by_role("table", name="Unassigned devices table", exact=True).wait_for()
        self.assert_compact_table_toolbar(devices, "Unassigned devices table", "Find unassigned devices", "Assign selected devices", "Move devices")
        self.table()
        self.assert_compact_table_toolbar(self.section, "Unassigned entities table", "Find unassigned entities", "Change the selected entities", "Move")
        self.page.set_viewport_size({"width": 390, "height": 844})
        chooser = self.section.get_by_role("button", name="Columns of Unassigned entities table", exact=True)
        chooser.click()
        columns = self.page.get_by_role("group", name="Columns", exact=True)
        self.assertTrue(columns.evaluate("e => {const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;}"))
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.keyboard.press("Escape")
        self.assertEqual(self.posted, [])

    def test_cards_and_table_preference_and_columns_persist(self):
        self.assertEqual(self.section.get_by_role("button", name="Cards", exact=True).get_attribute("aria-pressed"), "true")
        h = self.body["hierarchy"]
        floor = next(floor for floor in h["floors"] if floor["areaIds"])
        area = h["areas"][floor["areaIds"][0]]
        spaces = self.page.get_by_role("navigation", name="Spaces", exact=True)
        floor_label = spaces.locator("button[aria-expanded]").get_by_text(floor["name"], exact=True)
        area_label = spaces.locator("button:not([aria-expanded])").get_by_text(area["name"], exact=True)
        self.assertAlmostEqual(area_label.bounding_box()["x"] - floor_label.bounding_box()["x"], 12, delta=1)
        self.assertAlmostEqual(area_label.locator("..").bounding_box()["width"], floor_label.locator("..").bounding_box()["width"], delta=1)
        table = self.table()
        self.assertEqual(table.locator("tbody tr").count(), 100)
        # In a narrow window the least important columns give way; the Columns menu brings one back.
        self.page.set_viewport_size({"width": 480, "height": 1100})
        menu = self.section.get_by_role("button", name="Columns of Unassigned entities table", exact=True)
        menu.wait_for()
        menu.click()
        columns = self.page.get_by_role("group", name="Columns")
        crowded_out = columns.locator("label").filter(has_text="no room").first
        name = crowded_out.locator("span").first.inner_text().strip()
        crowded_out.locator("input").check()
        header = table.get_by_role("columnheader", name=name, exact=True)
        header.wait_for()
        self.page.keyboard.press("Escape")
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.reload(wait_until="domcontentloaded")
        self.open_entities()
        table.wait_for()
        self.assertEqual(self.section.get_by_role("button", name="Table", exact=True).get_attribute("aria-pressed"), "true")
        header.wait_for()
        screenshot = os.environ.get("TAXIS_UNASSIGNED_SCREENSHOT")
        if screenshot:
            os.makedirs(os.path.dirname(os.path.abspath(screenshot)), exist_ok=True)
            self.page.screenshot(path=screenshot, full_page=True)
        self.assertEqual(len(self.posted), 0)

    def test_pagination_reaches_records_past_four_hundred(self):
        table = self.table()
        self.assertEqual(table.locator("tbody tr").count(), 100)
        for _ in range(4):
            self.section.get_by_role("button", name="Next page", exact=True).click()
        table.get_by_role("button", name="Unplaced 450", exact=True).wait_for()
        self.assertEqual(table.locator("tbody tr").count(), 51)
        search = self.section.get_by_role("textbox", name="Find unassigned entities")
        search.fill("sensor.unplaced_450")
        self.assertEqual(table.locator("tbody tr").count(), 1)
        self.assertEqual(self.section.get_by_role("button", name="Next page", exact=True).count(), 0)

    def test_search_select_and_bulk_area_queue_respect_editability(self):
        table = self.table()
        search = self.section.get_by_role("textbox", name="Find unassigned entities")
        search.fill("Unplaced fixture bridge")
        self.assertEqual(table.locator("tbody tr").count(), 3)
        self.section.get_by_role("checkbox", name="Select all shown entities", exact=True).check()
        bulk = self.section.get_by_role("region", name="Change the selected entities")
        self.assertIn("2 selected", bulk.inner_text())
        bulk.locator("select#bulk-area").select_option(self.area)
        bulk.get_by_role("button", name="Move", exact=True).click()
        self.page.get_by_role("status").filter(has_text="1 left out").wait_for()
        self.assertEqual(self.posted, [{"kind": "entity", "op": "update", "targetId": "sensor.unplaced_000", "fields": {"area_id": self.area}}])
        search.fill("Unplaced 450")
        self.assertEqual(table.locator("tbody tr").count(), 1)
        self.assertIn("0 selected", bulk.inner_text())
        self.assertTrue(bulk.get_by_role("button", name="Move", exact=True).is_disabled())

    def test_header_checkbox_is_visible_mixed_and_selects_only_current_page(self):
        table = self.table()
        header = table.locator("thead").get_by_role("checkbox", name="Select all shown entities", exact=True)
        self.assertTrue(header.is_visible())
        table.get_by_role("checkbox", name="Select Unplaced 000", exact=True).check()
        self.assertTrue(header.evaluate("e => e.indeterminate"))
        header.check()
        bulk = self.section.get_by_role("region", name="Change the selected entities")
        self.assertIn("99 selected", bulk.inner_text())
        self.assertFalse(header.evaluate("e => e.indeterminate"))
        header.uncheck()
        self.assertIn("0 selected", bulk.inner_text())
        self.section.get_by_role("button", name="Next page", exact=True).click()
        header.check()
        self.assertIn("100 selected", bulk.inner_text())
        bulk.locator("select#bulk-area").select_option(self.area)
        bulk.get_by_role("button", name="Move", exact=True).click()
        self.page.wait_for_function("() => document.querySelector('[aria-label=\"Change the selected entities\"]').textContent.includes('0 selected')")
        self.assertEqual(len(self.posted), 100)
        self.assertTrue(all(100 <= int(v["targetId"].rsplit("_", 1)[1]) < 200 for v in self.posted))

    def test_inline_area_assignment_is_visible_and_respects_entity_restrictions(self):
        table = self.table()
        table.get_by_role("columnheader", name="Area", exact=True).wait_for()
        bulk = self.section.get_by_role("region", name="Change the selected entities")
        self.assertTrue(bulk.locator("select#bulk-area").is_disabled())
        self.assertTrue(bulk.get_by_role("button", name="Move", exact=True).is_disabled())
        self.assertTrue(table.get_by_role("combobox", name="Area for Unplaced 001", exact=True).is_disabled())
        self.assertTrue(table.get_by_role("combobox", name="Area for Unplaced 002", exact=True).is_disabled())
        table.get_by_role("combobox", name="Area for Unplaced 000", exact=True).select_option(self.area)
        self.page.get_by_role("status").filter(has_text="Added").wait_for()
        self.assertEqual(self.posted, [{"kind": "entity", "op": "update", "targetId": "sensor.unplaced_000", "fields": {"area_id": self.area}}])
        self.page.set_viewport_size({"width": 480, "height": 900})
        self.assertTrue(table.get_by_role("columnheader", name="Area", exact=True).is_visible())
        self.assertTrue(table.locator("thead").get_by_role("checkbox").is_visible())
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))


    def test_suggestion_queues_only_the_exact_area_after_acceptance(self):
        h = self.body["hierarchy"]
        template = next(iter(h["areas"].values()))
        for area_id, name in [("workshop", "Workshop"), ("annex", "Workshop Annex"), ("porch", "Porch")]:
            h["areas"][area_id] = {**template, "id": area_id, "name": name, "floorId": None, "entityIds": [], "deviceIds": []}
            h["looseAreaIds"].append(area_id)
        for index, name in [(0, "Workshop Annex lamp"), (1, "Workshop main switch"), (2, "Workshop unregistered"), (3, "Between Workshop and Porch")]:
            h["entities"][f"sensor.unplaced_{index:03}"]["name"] = name
        self.page.reload(wait_until="domcontentloaded")
        self.open_entities()
        table = self.table()
        self.section.get_by_role("textbox", name="Find unassigned entities").fill("Workshop")
        chosen = table.get_by_role("button", name="Use suggested area Workshop Annex for Workshop Annex lamp", exact=True)
        self.assertTrue(chosen.is_visible())
        dropdown = table.get_by_role("combobox", name="Area for Workshop Annex lamp", exact=True).bounding_box()
        accept = chosen.bounding_box()
        self.assertGreaterEqual(accept["x"], dropdown["x"] + dropdown["width"])
        self.assertAlmostEqual(accept["y"] + accept["height"]/2, dropdown["y"] + dropdown["height"]/2, delta=2)
        self.assertLessEqual(dropdown["width"], 115)
        self.assertTrue(table.get_by_role("button", name="Use suggested area Workshop for Workshop main switch", exact=True).is_disabled())
        self.assertTrue(table.get_by_role("button", name="Use suggested area Workshop for Workshop unregistered", exact=True).is_disabled())
        self.assertEqual(table.get_by_role("button", name="Use suggested area", exact=False).count(), 3)
        self.assertEqual(self.posted, [])
        chosen.click()
        self.page.get_by_role("status").filter(has_text="Added").wait_for()
        self.assertEqual(self.posted, [{"kind": "entity", "op": "update", "targetId": "sensor.unplaced_000", "fields": {"area_id": "annex"}}])

    def test_device_and_inherited_area_are_explicit_in_row_and_editor(self):
        table = self.table()
        row = table.locator("tbody tr").filter(has=self.page.get_by_role("button", name="Unplaced 000", exact=True))
        self.assertIn("Unplaced fixture bridge", row.inner_text())
        area_cell = row.get_by_role("combobox", name="Area for Unplaced 000", exact=True).locator("xpath=ancestor::td")
        self.assertNotIn("Unplaced fixture bridge", area_cell.inner_text())
        self.assertNotIn("Device has no area", area_cell.inner_text())
        self.assertNotIn("No device", area_cell.inner_text())
        row.get_by_role("button", name="Unplaced 000", exact=True).click()
        editor = self.page.get_by_role("region", name="Editor", exact=True)
        editor.get_by_text("Device: Unplaced fixture bridge · Device has no area", exact=True).wait_for()
        self.assertIn("no area", editor.locator("select#ent-area").locator("option:checked").inner_text())
        self.assertEqual(self.posted, [])


    def test_compact_subtitle_and_assignment_toolbar_use_one_line(self):
        self.assertEqual(self.section.get_by_text("Select all shown", exact=False).count(), 0)
        self.assertEqual(self.section.get_by_role("checkbox", name="Select all shown entities", exact=True).count(), 0)
        table = self.table()
        self.assertTrue(table.locator("thead").get_by_role("checkbox", name="Select all shown entities", exact=True).is_visible())
        self.page.set_viewport_size({"width": 480, "height": 900})
        subtitle = self.page.get_by_role("region", name="Unassigned items", exact=True).locator("header").first.locator("p")
        self.assertTrue(subtitle.evaluate("e => {const s=getComputedStyle(e); return s.whiteSpace==='nowrap' && e.clientHeight <= parseFloat(s.lineHeight)+1 && e.getAttribute('title')===e.textContent;}"))
        bulk = self.section.get_by_role("region", name="Change the selected entities")
        label = bulk.get_by_text("Assign area to selected entities", exact=True).bounding_box()
        select = bulk.locator("select#bulk-area").bounding_box()
        self.assertAlmostEqual(label["y"] + label["height"]/2, select["y"] + select["height"]/2, delta=2)
        bulk.get_by_role("button", name="Area assignment help", exact=True).click()
        self.page.get_by_role("tooltip").filter(has_text="Only selected entities on this page").wait_for()
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.assertEqual(self.posted, [])


    def test_area_picker_expands_to_names_without_widening_closed_field(self):
        self.body["hierarchy"]["areas"][self.area]["name"] = "A long invented reading room for quiet afternoon study"
        self.page.reload(wait_until="domcontentloaded")
        self.open_entities()
        self.page.set_viewport_size({"width": 480, "height": 900})
        table = self.table()
        select = table.get_by_role("combobox", name="Area for Unplaced 000", exact=True)
        closed = select.bounding_box()
        self.assertLessEqual(closed["width"], 115)
        if self.page.evaluate("CSS.supports('appearance', 'base-select') && CSS.supports('selector(select::picker(select))')"):
            select.click()
            option = select.locator("option").filter(has_text="A long invented reading room").first
            box = option.bounding_box()
            self.assertGreater(box["width"], closed["width"] + 60)
            self.assertGreaterEqual(box["x"], 0)
            self.assertLessEqual(box["x"] + box["width"], 480)
            self.assertEqual(select.evaluate("e => getComputedStyle(e, '::picker(select)').appearance"), "base-select")
            self.page.keyboard.press("Escape")
        self.assertEqual(self.posted, [])
        self.assertLessEqual(select.bounding_box()["width"], 115)
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        select.select_option(self.area)
        self.page.get_by_role("status").filter(has_text="Added").wait_for()
        self.assertEqual(self.posted, [{"kind": "entity", "op": "update", "targetId": "sensor.unplaced_000", "fields": {"area_id": self.area}}])


    def test_devices_open_first_and_counts_stay_independent_of_search(self):
        self.page.reload(wait_until="domcontentloaded")
        devices = self.page.get_by_role("tab", name="Devices (2)", exact=True)
        self.assertEqual(devices.get_attribute("aria-selected"), "true")
        self.assertTrue(self.page.get_by_role("tab", name="Entities (451)", exact=True).is_visible())
        region = self.page.get_by_role("region", name="Unassigned devices", exact=True)
        table = region.get_by_role("table", name="Unassigned devices table", exact=True)
        self.assertEqual(table.locator("tbody tr").count(), 2)
        self.assertIn("Empty service fixture", table.inner_text())
        self.assertNotIn("Placed fixture", table.inner_text())
        self.assertNotIn("Disabled fixture", table.inner_text())
        region.get_by_role("textbox", name="Find unassigned devices").fill("Empty")
        self.assertEqual(table.locator("tbody tr").count(), 1)
        self.assertEqual(devices.inner_text(), "Devices (2)")
        region.get_by_role("textbox", name="Find unassigned devices").fill("")
        self.page.get_by_role("checkbox", name="Show disabled and hidden entities", exact=True).check()
        self.page.get_by_role("tab", name="Devices (3)", exact=True).wait_for()
        self.assertEqual(table.locator("tbody tr").count(), 3)
        self.assertIn("Disabled fixture", table.inner_text())
        self.assertEqual(self.posted, [])

    def test_device_assignment_changes_only_device_and_preserves_entity_override(self):
        self.page.reload(wait_until="domcontentloaded")
        region = self.page.get_by_role("region", name="Unassigned devices", exact=True)
        region.get_by_role("combobox", name="Area for device Unplaced fixture bridge", exact=True).select_option(self.area)
        self.page.get_by_role("status").filter(has_text="Added").wait_for()
        self.assertEqual(self.posted, [{"kind": "device", "op": "update", "targetId": "fixture_device", "fields": {"area_id": self.area}}])
        self.page.get_by_role("tab", name="Devices (1)", exact=True).wait_for()
        self.page.get_by_role("tab", name="Entities (448)", exact=True).wait_for()
        h = self.body["hierarchy"]
        self.assertEqual(h["entities"]["sensor.unplaced_001"]["areaId"], self.area)
        self.assertIsNone(h["entities"]["sensor.unplaced_001"]["ownAreaId"])
        self.assertEqual(h["entities"]["sensor.fixed_area"]["areaId"], self.override_area)
        self.assertEqual(h["entities"]["sensor.fixed_area"]["ownAreaId"], self.override_area)
        self.open_entities()
        self.section.get_by_role("textbox", name="Find unassigned entities").fill("Unplaced fixture bridge")
        self.assertIn("No unassigned entities match", self.section.inner_text())

    def test_device_bulk_selection_is_page_scoped_and_queues_device_only_changes(self):
        h = self.body["hierarchy"]
        base = h["devices"]["empty_device"]
        for i in range(105):
            device_id = f"bulk_{i:03}"
            h["devices"][device_id] = {**base, "id": device_id, "name": f"Batch fixture {i:03}"}
        self.page.reload(wait_until="domcontentloaded")
        region = self.page.get_by_role("region", name="Unassigned devices", exact=True)
        region.get_by_role("textbox", name="Find unassigned devices").fill("Batch fixture")
        table = region.get_by_role("table", name="Unassigned devices table")
        self.assertEqual(table.locator("tbody tr").count(), 100)
        header = table.locator("thead").get_by_role("checkbox", name="Select all shown devices", exact=True)
        table.get_by_role("checkbox", name="Select Batch fixture 000", exact=True).check()
        self.assertTrue(header.evaluate("e => e.indeterminate"))
        header.check()
        self.assertIn("100 devices selected", region.inner_text())
        region.get_by_role("button", name="Next page", exact=True).click()
        self.assertIn("0 devices selected", region.inner_text())
        self.assertEqual(table.locator("tbody tr").count(), 5)
        header.check()
        bulk = region.get_by_role("region", name="Assign selected devices")
        bulk.locator("select#bulk-device-area").select_option(self.area)
        bulk.get_by_role("button", name="Move devices", exact=True).click()
        self.page.get_by_role("status").filter(has_text="5 changes added").wait_for()
        self.assertEqual(self.posted, [{"kind": "device", "op": "update", "targetId": f"bulk_{i:03}", "fields": {"area_id": self.area}} for i in range(100, 105)])


    def test_device_suggestion_requires_acceptance_and_restricted_entity_links_to_devices(self):
        self.table()
        self.section.get_by_role("textbox", name="Find unassigned entities").fill("Unplaced 001")
        self.section.get_by_role("button", name="Assign its device in Devices first.", exact=True).click()
        self.assertEqual(self.page.get_by_role("tab", name="Devices (2)", exact=True).get_attribute("aria-selected"), "true")
        h = self.body["hierarchy"]
        area_name = h["areas"][self.area]["name"]
        h["devices"]["fixture_device"]["name"] = area_name + " fixture hub"
        self.page.reload(wait_until="domcontentloaded")
        region = self.page.get_by_role("region", name="Unassigned devices", exact=True)
        accept = region.get_by_role("button", name=f"Use suggested area {area_name} for device {area_name} fixture hub", exact=True)
        accept.wait_for()
        self.assertTrue(accept.is_visible())
        self.assertEqual(self.posted, [])
        accept.click()
        self.page.get_by_role("status").filter(has_text="Added").wait_for()
        self.assertEqual(self.posted, [{"kind": "device", "op": "update", "targetId": "fixture_device", "fields": {"area_id": self.area}}])



if __name__ == "__main__":
    unittest.main(verbosity=2)
