"""The shared UI rules, checked on every page at a desktop and a phone width.

  * no page scrolls sideways (documentElement.scrollWidth <= clientWidth);
  * every table either fits its card or scrolls inside its own scroll area, and
    that area ends inside the window;
  * the navigation names the pages and the old links still open the new ones.

Build the app and start the mock first (see scripts/browser_common.py), then run:
  TAXIS_TEST_URL=http://localhost:8099 python3 scripts/ui-engine-browser.py
Every write is blocked; the pages are only read.
"""
import json
import re
import unittest
import urllib.request
from playwright.sync_api import sync_playwright
from browser_common import BASE, launch

VIEWPORTS = [(1280, 800), (375, 800)]

# The pages of the navigation, in order, and what each tab strip offers.
NAV = ["Guide", "Areas", "Organize", "Automations", "Parameters", "Health", "Changes", "Settings"]
ORGANIZE_TYPES = ["spaces", "labels", "category-automation", "category-script", "category-scene", "category-helpers",
                  "zones", "automations", "blueprints", "devices", "entities", "helpers"]
PARAMETER_TABS = ["capabilities", "helpers", "area-codes", "house", "occupancy", "lighting", "media", "climate", "fan", "exterior", "safety"]
AREA_TABS = ["overview", "capabilities", "devices-entities", "naming", "labels", "health"]

# Old link -> where it opens now.
REDIRECTS = [
    ("#recipes", "#automations/recipes"),
    ("#parameters/recipes", "#automations/recipes"),
    ("#buttons", "#automations/buttons"),
    ("#buttons/device%3Ademo_wall_buttons", "#automations/buttons/device%3Ademo_wall_buttons"),
    ("#ai-admin", "#settings/ai"),
    ("#ai", "#settings/ai"),
    ("#devices", "#organize/devices"),
    ("#entities", "#organize/entities"),
]

# Measured in the page: what is wrong with the layout right now, if anything.
PROBLEMS = """() => {
  const problems = [];
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) problems.push({page: 'scrolls sideways', scrollWidth: root.scrollWidth, clientWidth: root.clientWidth});
  const scrollsX = (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
  for (const table of document.querySelectorAll('table')) {
    if (!table.getClientRects().length) continue;
    const label = table.getAttribute('aria-label') || table.textContent.trim().slice(0, 30);
    // The nearest ancestor that clips or scrolls is the table's own scroll area.
    let area = table.parentElement;
    while (area && area !== document.body && !scrollsX(area) && getComputedStyle(area).overflowX !== 'hidden') area = area.parentElement;
    const box = (area && area !== document.body ? area : table).getBoundingClientRect();
    if (box.right > innerWidth + 1 || box.left < -1) problems.push({table: label, 'scroll area leaves the window': [Math.round(box.left), Math.round(box.right), innerWidth]});
    const tableBox = table.getBoundingClientRect();
    const fits = area && area !== document.body ? tableBox.width <= area.clientWidth + 1 : tableBox.right <= innerWidth + 1;
    if (!fits && !(area && area !== document.body && scrollsX(area))) problems.push({table: label, 'wider than its card and not scrollable': [Math.round(tableBox.width), area ? area.clientWidth : null]});
  }
  return problems;
}"""


class UiEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=20) as response:
            cls.hierarchy = json.load(response)["hierarchy"]
        areas = cls.hierarchy["areas"].values()
        # The area with the most entities has the longest tabs.
        cls.area = max(areas, key=lambda area: len(area["entityIds"]))["id"]
        cls.floor = next(floor["id"] for floor in cls.hierarchy["floors"] if floor["areaIds"])
        cls.playwright = sync_playwright().start()
        cls.browser = launch(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def new_page(self, width=1280, height=800):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        self.addCleanup(context.close)
        page = context.new_page()
        page.set_default_timeout(15000)
        page.set_default_navigation_timeout(30000)
        errors, writes = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def read_only(route):
            if route.request.method not in ["GET", "HEAD"]:
                writes.append(route.request.method + " " + route.request.url)
                route.fulfill(status=409, json={"ok": False, "error": "These checks only read"})
            else:
                route.continue_()
        page.route("**/api/**", read_only)
        self.addCleanup(lambda: self.assertEqual(writes, []))
        self.addCleanup(lambda: self.assertEqual(errors, []))
        return page

    def settle(self, page):
        """Two frames: the tables measure themselves and drop what does not fit before the first paint."""
        page.evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))")

    def open(self, page, route):
        page.goto("about:blank")
        page.goto(BASE + "/" + route, wait_until="networkidle")
        page.get_by_role("navigation", name="Pages").wait_for()
        # A page is drawn once the house is read: the line under the navigation counts its floors.
        page.get_by_text(re.compile(r"\d+ floors?")).first.wait_for()
        self.settle(page)

    def problems(self, page):
        problems = page.evaluate(PROBLEMS)
        if problems:
            # Give a late layout (fonts, a measured column) a moment before judging.
            try:
                page.wait_for_function("(js) => eval(js)().length === 0", arg="(" + PROBLEMS + ")", timeout=2000)
            except Exception:
                problems = page.evaluate(PROBLEMS)
            else:
                problems = []
        return problems

    def check_routes(self, routes, width, height, before=None):
        page = self.new_page(width, height)
        failed = {}
        for route in routes:
            with self.subTest(route=route, width=width):
                self.open(page, route)
                if before:
                    before(page, route)
                    self.settle(page)
                found = self.problems(page)
                if found:
                    failed[route] = found
                self.assertEqual(found, [], route)
        return failed

    # ---- every page, at both widths ---------------------------------------

    def test_top_level_pages_do_not_scroll_sideways_and_tables_stay_in_their_card(self):
        routes = ["#guide", "#home", "#floor/" + self.floor, "#unassigned", "#organize", "#automations/recipes", "#automations/buttons",
                  "#automations/buttons/device%3Ademo_wall_buttons", "#health", "#changes", "#settings", "#settings/ai"]
        for width, height in VIEWPORTS:
            self.check_routes(routes, width, height)

    def test_every_organize_section_fits(self):
        routes = ["#organize/" + kind for kind in ORGANIZE_TYPES]
        for width, height in VIEWPORTS:
            self.check_routes(routes, width, height)

    def test_every_organize_table_view_fits(self):
        def table_view(page, route):
            view = page.get_by_role("button", name="Table", exact=True)
            if view.count():
                view.first.click()
        # Devices and Entities show their table by default; the others have a list with the item beside it.
        for width, height in VIEWPORTS:
            self.check_routes(["#organize/devices", "#organize/entities", "#organize/automations", "#organize/helpers"], width, height, table_view)

    def test_every_parameters_tab_fits(self):
        routes = ["#parameters/" + tab for tab in PARAMETER_TABS]
        for width, height in VIEWPORTS:
            self.check_routes(routes, width, height)

    def test_every_tab_of_an_area_fits(self):
        routes = [f"#area/{self.area}" + ("" if tab == "overview" else "/" + tab) for tab in AREA_TABS]
        for width, height in VIEWPORTS:
            self.check_routes(routes, width, height)

    def test_recipes_and_buttons_table_views_fit(self):
        def table_view(page, route):
            view = page.get_by_role("button", name="Table", exact=True)
            if view.count():
                view.first.click()
        for width, height in VIEWPORTS:
            self.check_routes(["#automations/recipes"], width, height, table_view)

    # ---- the tables themselves --------------------------------------------

    def test_a_table_that_does_not_fit_scrolls_in_its_own_area_and_keeps_its_first_column(self):
        page = self.new_page(375, 800)
        self.open(page, "#parameters/helpers")
        region = page.get_by_role("region", name="Area helper coverage", exact=True)
        region.wait_for()
        self.assertTrue(region.evaluate("e => e.scrollWidth > e.clientWidth"), "the helper matrix is wider than a phone")
        self.assertIn(region.evaluate("e => getComputedStyle(e).overflowX"), ["auto", "scroll"])
        self.assertEqual(page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), True)
        # Scrolled to the far end, the first column is still in view, and so is the header.
        region.evaluate("e => { e.scrollLeft = e.scrollWidth; e.scrollTop = 0 }")
        first = region.locator("tbody tr").first.locator("td").nth(1)
        box, area = first.bounding_box(), region.bounding_box()
        self.assertGreaterEqual(box["x"], area["x"] - 1)
        self.assertLess(box["x"], area["x"] + area["width"] / 2)
        header = region.locator("thead th").nth(1).bounding_box()
        self.assertGreaterEqual(header["y"], area["y"] - 1)

    def test_a_hidden_column_is_one_arrow_away(self):
        page = self.new_page(375, 800)
        self.open(page, "#organize/automations")
        table = page.get_by_role("table", name="Automations list", exact=True)
        table.wait_for()
        arrow = table.get_by_role("button", name=re.compile(r"^Show the other columns of this row")).first
        arrow.click()
        self.assertEqual(table.get_by_role("button", name=re.compile(r"^Hide the other columns of this row")).count(), 1)
        self.assertTrue(page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))

    # ---- navigation and links ---------------------------------------------

    def test_navigation_names_the_pages_and_the_tabs(self):
        page = self.new_page(1280, 800)
        self.open(page, "#guide")
        nav = page.get_by_role("navigation", name="Pages")
        self.assertEqual([re.sub(r"\s+\d+$", "", re.sub(r"\s+", " ", text).strip()) for text in nav.get_by_role("button").all_inner_texts()], NAV)
        nav.get_by_role("button", name="Automations", exact=True).click()
        page.wait_for_function("location.hash === '#automations/recipes'")
        tabs = page.get_by_role("tablist", name="Automations")
        tabs.get_by_role("tab", name="Buttons", exact=True).wait_for()
        self.assertEqual([text.strip() for text in tabs.get_by_role("tab").all_inner_texts()], ["Recipes", "Buttons"])
        tabs.get_by_role("tab", name="Buttons", exact=True).click()
        page.wait_for_function("location.hash === '#automations/buttons'")
        nav.get_by_role("button", name="Settings", exact=True).click()
        page.wait_for_function("location.hash === '#settings'")
        tabs = page.get_by_role("tablist", name="Settings")
        self.assertEqual([text.strip() for text in tabs.get_by_role("tab").all_inner_texts()], ["General", "AI"])
        tabs.get_by_role("tab", name="AI", exact=True).click()
        page.wait_for_function("location.hash === '#settings/ai'")

    def test_the_phone_navigation_is_one_row_that_scrolls_by_itself(self):
        page = self.new_page(375, 800)
        self.open(page, "#guide")
        nav = page.get_by_role("navigation", name="Pages")
        tops = nav.get_by_role("button").evaluate_all("buttons => [...new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top)))]")
        self.assertEqual(len(tops), 1, tops)
        self.assertTrue(page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))

    def test_old_links_open_the_new_pages(self):
        page = self.new_page(1280, 800)
        for old, new in REDIRECTS:
            with self.subTest(old=old):
                page.goto("about:blank")
                page.goto(BASE + "/" + old, wait_until="networkidle")
                page.wait_for_function("(hash) => location.hash === hash", arg=new)
                page.get_by_text(re.compile(r"\d+ floors?")).first.wait_for()
        page.goto("about:blank")
        page.goto(BASE + f"/#area/{self.area}/devices", wait_until="networkidle")
        page.wait_for_function("(hash) => location.hash === hash", arg=f"#area/{self.area}/devices-entities")

    def test_an_empty_or_unknown_link_opens_the_guide(self):
        page = self.new_page(1280, 800)
        for route in ["", "#", "#nowhere", "#guide"]:
            with self.subTest(route=route):
                page.goto("about:blank")
                page.goto(BASE + "/" + route, wait_until="networkidle")
                page.get_by_role("heading", name="Guide", exact=True).wait_for()
                page.get_by_role("heading", name="Your path", exact=True).wait_for()


if __name__ == "__main__":
    unittest.main(verbosity=2)
