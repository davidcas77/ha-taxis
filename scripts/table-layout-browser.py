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

    def open(self, route):
        self.page.goto(BASE + "/" + route, wait_until="domcontentloaded")
        if route == "#unassigned":
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
        routes = ["#health", "#unassigned", "#organize/entities", "#organize/devices/" + device,
                  "#organize/category-automation/" + category, "#organize/labels/" + label,
                  "#organize/blueprints", "#automations/recipes", "#automations/buttons/device%3Ademo_wall_buttons",
                  "#parameters/capabilities", "#parameters/helpers", "#parameters/area-codes", "#settings/ai",
                  "#area/" + area, "#area/" + area + "/capabilities", "#area/" + area + "/naming", "#parameters/house"]
        tested_tables = 0
        for route in routes:
            self.open(route)
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
