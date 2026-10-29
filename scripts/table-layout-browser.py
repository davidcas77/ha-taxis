"""Layout of the one data table (web/src/data-table.tsx) against the built mock preview.

A table fits its card or scrolls inside it, never the page; its columns can be
shown and hidden from the Columns menu and that survives a reload; a long entity
id ends in an ellipsis with the whole id in a tooltip. Build the app and start the
mock first (see scripts/browser_common.py), then run:
  TAXIS_TEST_URL=http://localhost:8099 python3 scripts/table-layout-browser.py
All writes are intercepted; stress values exist only in browser DOM/fixtures.
"""
import copy
import json
import re
import unittest
import urllib.request
from playwright.sync_api import expect, sync_playwright
from browser_common import BASE, launch, screenshot_dir

LONG_ID = "automation.balcony_door_open_serenity_delta_alert_" + "long_identifier_" * 12


class TableLayoutRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=20) as response:
            cls.body = json.load(response)
        cls.playwright = sync_playwright().start()
        cls.browser = launch(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1100}, color_scheme="dark")
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.page.set_default_navigation_timeout(30000)
        self.writes = []
        def read_only(route):
            if route.request.method not in ["GET", "HEAD"]:
                self.writes.append(route.request.url)
                route.fulfill(status=409, json={"ok": False, "error": "Layout checks do not write"})
            else:
                route.continue_()
        self.page.route("**/api/**", read_only)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.writes, [])

    def open(self, route, entities=False):
        self.page.goto(BASE + "/" + route, wait_until="domcontentloaded")
        if route == "#unassigned" and entities:
            self.page.get_by_role("tab", name=re.compile(r"^Entities \(")).click()
            self.page.get_by_role("group", name="Unassigned view", exact=True).get_by_role("button", name="Table", exact=True).click()
        self.page.locator("table").first.wait_for()

    def region(self, label):
        return self.page.get_by_role("region", name=label, exact=True)

    def assert_page_does_not_scroll(self, context=""):
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), context)

    def assert_regions_inside_viewport(self, context=""):
        """Every table's scroll area ends inside the window and scrolls by itself: a wide table scrolls in its own region."""
        bad = self.page.evaluate("""() => [...document.querySelectorAll('div[role=region]:has(> table)')]
            .map(region => ({label: region.getAttribute('aria-label'), right: region.getBoundingClientRect().right, inner: innerWidth, scrolls: getComputedStyle(region).overflowX}))
            .filter(r => r.right > r.inner + 1 || (r.scrolls !== 'auto' && r.scrolls !== 'scroll'))""")
        self.assertEqual(bad, [], context)

    def assert_every_table_has_a_chooser_above_it(self, context=""):
        for table in self.page.get_by_role("table").all():
            label = table.get_attribute("aria-label")
            self.assertTrue(label, context)
            wrapper = table.locator("xpath=ancestor::*[@data-table-id][1]")
            chooser = wrapper.get_by_role("button", name="Columns of " + label, exact=True)
            expect(chooser).to_have_count(1)
            self.assertEqual(table.get_by_role("separator").count(), table.locator("th[data-column-id]").count(), context)
            toolbar = wrapper.get_by_role("toolbar", name="Table controls for " + label, exact=True)
            search = toolbar.locator("input[data-table-search]")
            expect(search).to_have_count(1)
            self.assertLessEqual(toolbar.bounding_box()["y"] + toolbar.bounding_box()["height"], table.bounding_box()["y"] + 1, context)
            self.assertTrue(table.evaluate("table => { const root=table.closest('[data-table-id]'), toolbar=root.querySelector('[role=toolbar]'), frame=table.parentElement.parentElement; return toolbar.parentElement===frame.parentElement && !frame.contains(toolbar); }"), context)
            first_row = table.locator("tr").first
            self.assertGreater(first_row.locator("th").count(), 0, context)
            self.assertEqual(first_row.locator("td").count(), 0, context)
            search_box = search.bounding_box()
            columns_box = chooser.bounding_box()
            self.assertAlmostEqual(search_box["y"] + search_box["height"] / 2, columns_box["y"] + columns_box["height"] / 2, delta=2, msg=context)
            self.assertGreater(columns_box["x"], search_box["x"], context)
            self.assertLessEqual(columns_box["x"] + columns_box["width"], wrapper.bounding_box()["x"] + wrapper.bounding_box()["width"] + 1, context)

    def test_small_tables_have_a_chooser_and_locked_columns_stay_required(self):
        self.open("#home")
        self.assert_every_table_has_a_chooser_above_it("Home summary")
        table = self.page.get_by_role("table").first
        label = table.get_attribute("aria-label")
        wrapper = table.locator("xpath=ancestor::*[@data-table-id][1]")
        wrapper.get_by_role("button", name="Columns of " + label, exact=True).click()
        columns = wrapper.get_by_role("group", name="Columns", exact=True)
        first = columns.get_by_role("checkbox").first
        first.uncheck()
        self.assertEqual(table.get_by_role("columnheader").count(), 3)
        columns.get_by_role("button", name="Reset columns", exact=True).click()
        self.assertEqual(table.get_by_role("columnheader").count(), 4)
        self.page.keyboard.press("Escape")
        self.open("#unassigned", entities=True)
        self.section = self.page.get_by_role("region", name="Unassigned entities", exact=True)
        self.section.get_by_role("button", name="Columns of Unassigned entities table", exact=True).click()
        columns = self.section.get_by_role("group", name="Columns", exact=True)
        self.assertTrue(columns.get_by_label("Select", exact=False).is_disabled())
        self.assertTrue(columns.get_by_label("Area", exact=False).is_disabled())
        self.page.keyboard.press("Escape")
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assert_every_table_has_a_chooser_above_it("Narrow unassigned table")
        self.section.get_by_role("button", name="Columns of Unassigned entities table", exact=True).click()
        columns = self.section.get_by_role("group", name="Columns", exact=True)
        self.assertTrue(columns.evaluate("e => {const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;}"))
        self.page.screenshot(path=str(screenshot_dir() / "table-column-chooser.png"))

    def test_default_search_filters_rows_and_remains_available_for_no_matches(self):
        self.open("#home")
        table = self.page.get_by_role("table", name="Floors", exact=True)
        wrapper = table.locator("xpath=ancestor::*[@data-table-id][1]")
        search = wrapper.get_by_role("textbox", name="Search Floors", exact=True)
        original_rows = table.locator("tbody tr").count()
        self.assertGreater(original_rows, 1)
        name = table.locator("tbody tr").first.locator("td").first.inner_text().strip()
        self.assertTrue(name)
        search.fill(name)
        expect(table.locator("tbody tr")).to_have_count(1)
        self.assertIn(name, table.locator("tbody").inner_text())
        search.fill("no-such-floor-fixture-875")
        expect(wrapper.get_by_role("textbox", name="Search Floors", exact=True)).to_be_visible()
        expect(wrapper.get_by_role("button", name="Columns of Floors", exact=True)).to_be_visible()
        self.assertNotIn(name, wrapper.inner_text())
        search.fill("")
        expect(table.locator("tbody tr")).to_have_count(original_rows)
        original_headers = table.locator("th[data-column-id]").count()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.wait_for_function("count => document.querySelectorAll('[data-table-id=\"home-floors\"] th[data-column-id]').length < count", arg=original_headers)
        self.assert_page_does_not_scroll()
        self.assert_regions_inside_viewport()
        self.page.set_viewport_size({"width": 1600, "height": 1100})
        expect(table.locator("th[data-column-id]")).to_have_count(original_headers)
        self.assert_page_does_not_scroll()

    def test_helper_search_keeps_header_selection_scoped_to_matching_rows(self):
        self.page.goto(BASE + "/#parameters/helpers", wait_until="domcontentloaded")
        self.page.get_by_role("tab", name="Details", exact=True).click()
        table = self.page.get_by_role("table", name="Area helpers", exact=True)
        table.wait_for()
        choices = table.locator("tbody").get_by_role("checkbox")
        self.assertGreater(choices.count(), 1)
        canonical = choices.first.get_attribute("aria-label").removeprefix("Add ")
        wrapper = table.locator("xpath=ancestor::*[@data-table-id][1]")
        search = wrapper.get_by_role("textbox", name="Find areas helpers", exact=True)
        search.fill(canonical)
        expect(table.locator("tbody tr")).to_have_count(1)
        table.locator("thead").get_by_role("checkbox", name="Select all that can be added", exact=True).check()
        search.fill("")
        self.assertGreater(choices.count(), 1)
        expect(table.locator("tbody input[type=checkbox]:checked")).to_have_count(1)
        expect(wrapper.get_by_role("button", name="Add 1 to changes", exact=True)).to_be_visible()
        self.assert_page_does_not_scroll()

    def test_tables_fit_their_card_or_scroll_inside_it_at_any_width(self):
        area = next(iter(self.body["hierarchy"]["areas"]))
        self.open("#area/" + area)
        table = self.page.get_by_role("table", name="Area capabilities", exact=True)
        region = self.region("Area capabilities")
        table.wait_for()
        for width in [2000, 1600, 390]:
            self.page.set_viewport_size({"width": width, "height": 1100})
            box = region.bounding_box()
            self.assertLessEqual(box["x"] + box["width"], width + 1, width)
            self.assert_page_does_not_scroll(width)
            self.assert_regions_inside_viewport(width)
            # What does not fit is reached by scrolling the region itself.
            if region.evaluate("e => e.scrollWidth > e.clientWidth + 1"):
                self.assertIn(region.evaluate("e => getComputedStyle(e).overflowX"), ["auto", "scroll"])

    def test_saved_column_choices_survive_a_reload_and_reset(self):
        self.open("#organize/devices")
        table = self.page.get_by_role("table", name="Devices and entities", exact=True)
        state = table.get_by_role("columnheader", name="State", exact=True)
        key = "taxis:table:v3:devices-entities-devices"
        expect(state).to_have_count(1)
        # A saved choice is honoured when the page opens.
        self.page.evaluate("key => localStorage.setItem(key, JSON.stringify({show: [], hide: ['state']}))", key)
        self.page.reload(wait_until="domcontentloaded")
        table.wait_for()
        expect(state).to_have_count(0)
        self.page.get_by_role("button", name="Columns of Devices and entities", exact=True).click()
        columns = self.page.get_by_role("group", name="Columns")
        self.assertFalse(columns.get_by_label("State", exact=True).is_checked())
        # Showing it again is remembered as a choice too ...
        columns.get_by_label("State", exact=True).check()
        expect(state).to_have_count(1)
        self.assertEqual(json.loads(self.page.evaluate("key => localStorage.getItem(key)", key)), {"show": ["state"], "hide": []})
        # ... and so is hiding another one, which comes back with the layout reset.
        columns.get_by_label("Area", exact=True).uncheck()
        area = table.get_by_role("columnheader", name="Area", exact=True)
        expect(area).to_have_count(0)
        self.page.keyboard.press("Escape")
        self.page.reload(wait_until="domcontentloaded")
        table.wait_for()
        expect(area).to_have_count(0)
        self.page.evaluate("window.dispatchEvent(new Event('taxis:reset-layout'))")
        expect(area).to_have_count(1)

    def test_column_drag_and_keyboard_widths_survive_reload_and_reset(self):
        self.open("#home")
        table = self.page.get_by_role("table", name="Floors", exact=True)
        table.wait_for()
        header = table.get_by_role("columnheader", name="Floor", exact=True)
        handle = header.get_by_role("separator", name="Resize Floor column", exact=True)
        original = header.bounding_box()["width"]
        original_sort = header.get_attribute("aria-sort")
        box = handle.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.mouse.down()
        self.page.mouse.move(box["x"] + box["width"] / 2 + 85, box["y"] + box["height"] / 2, steps=5)
        self.page.mouse.up()
        self.assertAlmostEqual(header.bounding_box()["width"], original + 85, delta=3)
        self.assertEqual(header.get_attribute("aria-sort"), original_sort)
        resized = header.bounding_box()["width"]
        self.page.reload(wait_until="domcontentloaded")
        header.wait_for()
        self.assertAlmostEqual(header.bounding_box()["width"], resized, delta=2)
        handle.focus()
        handle.press("ArrowRight")
        self.assertAlmostEqual(header.bounding_box()["width"], resized + 10, delta=2)
        self.page.get_by_role("button", name="Columns of Floors", exact=True).click()
        self.page.get_by_role("group", name="Columns", exact=True).get_by_role("button", name="Reset columns", exact=True).click()
        self.page.keyboard.press("Escape")
        self.assertAlmostEqual(header.bounding_box()["width"], original, delta=2)
        handle.focus()
        handle.press("ArrowRight")
        self.page.evaluate("window.dispatchEvent(new Event('taxis:reset-layout'))")
        self.assertAlmostEqual(header.bounding_box()["width"], original, delta=2)
        self.page.reload(wait_until="domcontentloaded")
        header.wait_for()
        self.assertAlmostEqual(header.bounding_box()["width"], original, delta=2)
        self.assert_page_does_not_scroll()

    def test_view_changes_keep_the_table_inside_the_page(self):
        self.page.add_init_script("localStorage.setItem('taxis:organize-view:devices', 'table')")
        self.open("#organize/devices")
        modes = self.page.get_by_role("group", name="Entity view", exact=True)
        for mode in ["Devices", "Entities", "Devices", "Entities"]:
            modes.get_by_role("button", name=mode, exact=True).click()
            table = self.page.get_by_role("table", name="Devices and entities", exact=True)
            table.wait_for()
            self.assertEqual(table.get_by_role("columnheader", name="Name", exact=True).count(), 1, mode)
            self.assertEqual(self.page.get_by_role("button", name="Columns of Devices and entities", exact=True).count(), 1, mode)
            self.assert_page_does_not_scroll(mode)
            self.assert_regions_inside_viewport(mode)

    def test_a_long_entity_id_ends_in_an_ellipsis_with_the_whole_id_in_a_tooltip(self):
        body = copy.deepcopy(self.body)
        h = body["hierarchy"]
        base = next(iter(h["entities"].values()))
        category = h["categories"]["automation"][0]
        entity = {**copy.deepcopy(base), "entityId": LONG_ID, "name": "Long automation for wrapping", "domain": "automation", "role": "automation", "platform": "automation", "categoryScope": "automation", "categories": {}, "members": [], "areaId": None, "ownAreaId": None, "deviceId": None, "disabled": False, "hidden": False, "maintenance": False, "inRegistry": True}
        h["entities"][LONG_ID] = entity
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=body))
        self.open("#organize/category-automation/" + category["id"])
        search = self.page.get_by_role("textbox", name="Search entities", exact=True)
        search.fill("Long automation for wrapping")
        code = self.page.locator("td code").filter(has_text=LONG_ID)
        code.wait_for()

        def check():
            shown = code.locator("xpath=ancestor::div[contains(@class, 'truncate')][1]")
            self.assertEqual(shown.get_attribute("title"), LONG_ID)
            self.assertEqual(code.text_content(), LONG_ID)
            # One line, cut short, inside its cell: not wrapped in the middle of the id.
            result = shown.evaluate("""element => {
                const cell = element.closest('td').getBoundingClientRect(), box = element.getBoundingClientRect(), style = getComputedStyle(element);
                return {cut: element.scrollWidth > element.clientWidth, ellipsis: style.textOverflow, inside: box.left >= cell.left - 1 && box.right <= cell.right + 1, height: box.height, line: parseFloat(style.lineHeight)};
            }""")
            self.assertTrue(result["cut"], result)
            self.assertEqual(result["ellipsis"], "ellipsis", result)
            self.assertTrue(result["inside"], result)
            self.assertLess(result["height"], result["line"] * 1.6, result)

        check()
        self.assert_page_does_not_scroll()
        self.page.reload(wait_until="domcontentloaded")
        search.fill("Long automation for wrapping")
        code.wait_for()
        check()
        self.page.screenshot(path=str(screenshot_dir() / "assignment-wrapping.png"))

    def test_every_table_family_keeps_long_text_inside_the_page(self):
        h = self.body["hierarchy"]
        area = next(iter(h["areas"]))
        device = next(iter(h["devices"]))
        category = h["categories"]["automation"][0]["id"]
        label = next(iter(h["labels"]))
        routes = ["#health", "#unassigned", "#unassigned", "#organize/entities", "#organize/devices/" + device,
                  "#organize/category-automation/" + category, "#organize/labels/" + label,
                  "#organize/blueprints", "#automations/recipes", "#automations/buttons/device%3Ademo_wall_buttons",
                  "#parameters/capabilities", "#parameters/helpers", "#parameters/area-codes", "#settings/ai",
                  "#area/" + area, "#area/" + area + "/capabilities", "#area/" + area + "/naming", "#parameters/house"]
        tested_tables = 0
        unassigned_seen = False
        for route in routes:
            self.open(route, entities=route == "#unassigned" and unassigned_seen)
            if route == "#unassigned":
                unassigned_seen = True
            self.assert_every_table_has_a_chooser_above_it(route)
            if route == "#automations/recipes":
                self.page.get_by_role("button", name="Table", exact=True).click()
            tested_tables += self.page.locator("table").evaluate_all("""(tables, token) => {
                let tested = 0;
                for (const table of tables) {
                    let here = 0;
                    for (const td of table.querySelectorAll('tbody td')) {
                        if (td.matches('.whitespace-nowrap') || td.querySelector('input,select,button,details,textarea') || !td.textContent.trim() || !td.getBoundingClientRect().height) continue;
                        (td.querySelector('code') ?? td).textContent = token;
                        here++;
                    }
                    if (here) tested++;
                }
                return tested;
            }""", LONG_ID)
            # Whatever a cell holds, the table grows inside its own region and the page does not.
            self.assert_page_does_not_scroll(route)
            self.assert_regions_inside_viewport(route)
        self.assertGreaterEqual(tested_tables, 12)
        print("Verified long text in", tested_tables, "rendered tables across all table families", flush=True)

    def test_editors_and_headers_stay_inside_their_cells(self):
        area = next(iter(self.body["hierarchy"]["areas"]))
        routes = ["#parameters/area-codes", "#organize/devices", "#area/" + area + "/naming", "#parameters/house", "#parameters/climate", "#automations/recipes"]
        for width in [1600, 800]:
            self.page.set_viewport_size({"width": width, "height": 1100})
            for route in routes:
                self.open(route)
                if route in ["#organize/devices", "#automations/recipes"]:
                    self.page.get_by_role("button", name="Table", exact=True).click()
                errors = self.page.locator("table").evaluate_all("""tables => {
                  const bad = [];
                  for (const table of tables) {
                    for (const control of table.querySelectorAll('th button,td input:not([type=checkbox]),td select')) {
                      if (!control.getBoundingClientRect().height) continue;
                      const cell = control.closest('td,th'), c = cell.getBoundingClientRect(), b = control.getBoundingClientRect();
                      if (b.left < c.left - 1 || b.right > c.right + 1) bad.push({label: control.getAttribute('aria-label') ?? control.textContent, cell: c.width, width: b.width});
                    }
                  }
                  return bad;
                }""")
                self.assertEqual(errors, [], {"route": route, "width": width, "errors": errors})

    def test_active_parameter_editors_fit_without_saving(self):
        self.page.set_viewport_size({"width": 700, "height": 1100})
        self.open("#parameters/house")
        self.page.get_by_role("button", name=re.compile(r"^Night starts for House default:")).click()
        editor = self.page.get_by_label("Night starts for House default", exact=True)
        editor.wait_for()
        self.assertTrue(editor.evaluate("e=>{const c=e.closest('td').getBoundingClientRect(),r=e.getBoundingClientRect();return r.left>=c.left&&r.right<=c.right;}"))
        editor.press("Escape")
        self.page.set_viewport_size({"width": 1100, "height": 1100})
        self.open("#parameters/lighting")
        self.page.get_by_role("button", name=re.compile(r"^Entry lights for Living room:")).click()
        choices = self.page.get_by_role("dialog", name="Entry lights for Living room", exact=True)
        choices.wait_for()
        self.assertGreater(choices.get_by_role("checkbox").count(), 0)
        self.assertTrue(choices.evaluate("e=>{const r=e.getBoundingClientRect();return !e.closest('table')&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}"))
        choices.get_by_role("button", name="Done", exact=True).click()


if __name__ == "__main__":
    unittest.main(verbosity=2)
