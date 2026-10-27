"""Long-text and resized-column regressions against the built mock preview.

Start `npm run dev:mock` and build the app first, then run:
  TAXIS_TEST_URL=http://localhost:8099 python3 scripts/table-layout-browser.py
All writes are intercepted; stress values exist only in browser DOM/fixtures.
"""
import copy
import json
import os
import re
import unittest
import urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:8099")
LONG_ID = "automation.balcony_door_open_serenity_delta_alert_" + "long_identifier_" * 12


class TableLayoutRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=20) as response:
            cls.body = json.load(response)
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])

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

    def assert_text_fits(self, target):
        result = target.evaluate("""element => {
          const cell = element.closest('td');
          const c = cell.getBoundingClientRect();
          const style = getComputedStyle(cell);
          const range = document.createRange(); range.selectNodeContents(element);
          const rects = [...range.getClientRects()];
          return {text:element.textContent, lines:rects.length, left:c.left+parseFloat(style.paddingLeft), right:c.right-parseFloat(style.paddingRight), rects:rects.map(r=>({left:r.left,right:r.right}))};
        }""")
        self.assertGreater(result["lines"], 1, result)
        self.assertTrue(all(rect["left"] >= result["left"] - 1 and rect["right"] <= result["right"] + 1 for rect in result["rects"]), result)

    def test_default_columns_fit_headers_and_values_without_filling_the_page(self):
        area = next(iter(self.body["hierarchy"]["areas"]))
        self.open("#area/" + area)
        table = self.page.get_by_role("table", name="Area capabilities", exact=True)
        self.page.wait_for_function("document.querySelector('table[aria-label=\"Area capabilities\"]')?.dataset.contentSized === 'true'")
        result = table.evaluate("""table => {
          const columns = [...table.tHead.rows[0].cells].map((header, index) => {
            const cells = [header, ...[...table.tBodies[0].rows].map(row => row.cells[index])];
            const natural = Math.max(...cells.map(cell => {
              const range = document.createRange(), walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
              const rects = [];
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (!node.textContent.trim() || node.parentElement.closest('.sr-only,[role="separator"]')) continue;
                range.selectNodeContents(node);
                rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0));
              }
              const left = Math.min(...rects.map(rect => rect.left));
              const right = Math.max(...rects.map(rect => rect.right));
              const style = getComputedStyle(cell);
              return right - left + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            }));
            return {width:header.getBoundingClientRect().width, natural};
          });
          return {columns, width:table.getBoundingClientRect().width, border:table.parentElement.getBoundingClientRect().width, viewport:innerWidth};
        }""")
        self.assertLess(result["width"], result["viewport"] / 2, result)
        self.assertAlmostEqual(result["border"], result["width"] + 2, delta=2)
        for column in result["columns"]:
            self.assertGreaterEqual(column["width"], column["natural"], result)
            self.assertLessEqual(column["width"], column["natural"] + 12, result)
        original = table.locator("th").first.bounding_box()["width"]
        self.page.set_viewport_size({"width": 2000, "height": 1100})
        self.assertAlmostEqual(table.locator("th").first.bounding_box()["width"], original, delta=1)
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(table.evaluate("t=>t.parentElement.getBoundingClientRect().right<=innerWidth+1"))
        self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), True)

    def test_saved_explicit_columns_survive_and_reset_returns_to_content_widths(self):
        self.page.add_init_script("localStorage.setItem('taxis:records:columns:automations', JSON.stringify({name: 360}))")
        self.open("#organize/automations")
        table = self.page.locator("table").first
        self.page.wait_for_function("document.querySelector('table')?.dataset.contentSized === 'true'")
        self.assertAlmostEqual(table.locator("th").first.bounding_box()["width"], 360, delta=1)
        handle = self.page.get_by_role("separator", name="Resize Name column", exact=True)
        handle.focus()
        self.page.keyboard.press("ArrowRight")
        self.assertAlmostEqual(table.locator("th").first.bounding_box()["width"], 380, delta=1)
        self.page.reload(wait_until="domcontentloaded")
        self.page.wait_for_function("document.querySelector('table')?.dataset.contentSized === 'true'")
        self.assertAlmostEqual(table.locator("th").first.bounding_box()["width"], 380, delta=1)
        self.page.get_by_role("button", name="Reset layout", exact=True).click()
        self.page.wait_for_function("document.querySelector('table th').getBoundingClientRect().width < 360")
        reset_width = table.locator("th").first.bounding_box()["width"]
        self.assertGreater(reset_width, 64)

    def test_category_entity_id_wraps_after_resize_and_reload(self):
        body = copy.deepcopy(self.body)
        h = body["hierarchy"]
        base = next(iter(h["entities"].values()))
        category = h["categories"]["automation"][0]
        entity = {**copy.deepcopy(base), "entityId": LONG_ID, "name": "Long automation for wrapping", "domain": "automation", "role": "automation", "platform": "automation", "categoryScope": "automation", "categories": {}, "members": [], "areaId": None, "ownAreaId": None, "deviceId": None, "disabled": False, "hidden": False, "maintenance": False, "inRegistry": True}
        h["entities"][LONG_ID] = entity
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=body))
        route = "#organize/category-automation/" + category["id"]
        self.open(route)
        self.page.get_by_role("textbox", name="Search entities", exact=True).fill("Long automation for wrapping")
        code = self.page.locator("td code").filter(has_text=LONG_ID)
        code.wait_for()
        handle = self.page.get_by_role("separator", name="Resize Entity id column", exact=True)
        handle.focus()
        for _ in range(80):
            if float(handle.get_attribute("aria-valuenow")) <= 200:
                break
            self.page.keyboard.press("ArrowLeft")
        self.assert_text_fits(code)
        width = code.locator("..").bounding_box()["width"]
        self.page.reload(wait_until="domcontentloaded")
        self.page.get_by_role("textbox", name="Search entities", exact=True).fill("Long automation for wrapping")
        code.wait_for()
        self.assertAlmostEqual(code.locator("..").bounding_box()["width"], width, delta=2)
        self.assert_text_fits(code)
        self.assertEqual(code.text_content(), LONG_ID)
        self.page.screenshot(path="/workspace/.cache/ha-taxis/inspection/assignment-wrapping.png")

    def test_every_table_family_keeps_unbroken_text_inside_cells(self):
        h = self.body["hierarchy"]
        area = next(iter(h["areas"]))
        device = next(iter(h["devices"]))
        category = h["categories"]["automation"][0]["id"]
        label = next(iter(h["labels"]))
        routes = ["#", "#settings", "#health", "#unassigned", "#organize/entities", "#organize/devices/"+device,
                  "#organize/category-automation/"+category, "#organize/labels/"+label,
                  "#organize/blueprints", "#recipes", "#parameters/capabilities", "#parameters/helpers", "#parameters/area-codes",
                  "#area/"+area, "#area/"+area+"/capabilities", "#area/"+area+"/naming", "#parameters/house"]
        tested_tables = 0
        for route in routes:
            self.open(route)
            if route == "#recipes":
                self.page.get_by_role("button", name="Table", exact=True).click()
            tables = self.page.locator("table")
            for table in tables.all():
                result = table.evaluate("""(table, token) => {
                  const headers=[...(table.tHead?.rows[0]?.cells??[])];
                  table.style.tableLayout='fixed';table.style.width=`${headers.length*120}px`;
                  table.querySelectorAll('col').forEach(col=>col.style.width='120px');
                  headers.forEach(th=>th.style.width='120px');
                  let tested=0;const bad=[];
                  for(const td of table.querySelectorAll('tbody td')){
                    if(td.matches('.truncate,.whitespace-nowrap')||td.querySelector('input,select,button,details,textarea')||!td.textContent.trim()||!td.getBoundingClientRect().height)continue;
                    const target=td.querySelector('code')??td;
                    target.textContent=token;
                    const box=td.getBoundingClientRect(),style=getComputedStyle(td),range=document.createRange();range.selectNodeContents(target);
                    const rects=[...range.getClientRects()];tested++;
                    if(rects.length<2||rects.some(r=>r.left<box.left+parseFloat(style.paddingLeft)-1||r.right>box.right-parseFloat(style.paddingRight)+1))bad.push({text:target.textContent,cell:box.width,rects:rects.map(r=>({left:r.left-box.left,right:r.right-box.left}))});
                  }
                  return {tested,bad};
                }""", LONG_ID)
                self.assertEqual(result["bad"], [], {"route": route, "result": result})
                if result["tested"]:
                    tested_tables += 1
        self.assertGreaterEqual(tested_tables, 16)
        print("Verified long text in", tested_tables, "rendered tables across all table families", flush=True)

    def test_resized_editors_and_headers_stay_inside_their_columns(self):
        area = next(iter(self.body["hierarchy"]["areas"]))
        routes = ["#settings", "#organize/devices", "#area/"+area+"/naming", "#parameters/house", "#parameters/climate", "#recipes"]
        for route in routes:
            self.open(route)
            if route == "#organize/devices":
                self.page.get_by_role("button", name="Table", exact=True).click()
            if route == "#recipes":
                self.page.get_by_role("button", name="Table", exact=True).click()
            errors = self.page.locator("table").evaluate_all("""tables => {
              const bad=[];
              for(const table of tables){
                const headers=[...(table.tHead?.rows[0]?.cells??[])];
                table.style.tableLayout='fixed';table.style.width=`${headers.length*100}px`;
                table.querySelectorAll('col').forEach(col=>col.style.width='100px');headers.forEach(th=>th.style.width='100px');
                for(const control of table.querySelectorAll('th button,td input:not([type=checkbox]),td select')){
                  if(!control.getBoundingClientRect().height)continue;
                  const cell=control.closest('td,th'),c=cell.getBoundingClientRect(),b=control.getBoundingClientRect();
                  if(b.left<c.left-1||b.right>c.right+1)bad.push({label:control.getAttribute('aria-label')??control.textContent,cell:c.width,width:b.width});
                }
              }return bad;
            }""")
            self.assertEqual(errors, [], {"route": route, "errors": errors})

    def test_active_parameter_editors_fit_without_saving(self):
        self.open("#parameters/house")
        self.page.locator("table").evaluate("""table => {
          const headers=[...table.tHead.rows[0].cells];table.style.tableLayout='fixed';table.style.width=`${headers.length*100}px`;
          headers.forEach(th=>th.style.width='100px');
        }""")
        self.page.get_by_role("button", name=re.compile(r"^Night starts for House default:")).click()
        editor = self.page.get_by_label("Night starts for House default", exact=True)
        editor.wait_for()
        self.assertTrue(editor.evaluate("e=>{const c=e.closest('td').getBoundingClientRect(),r=e.getBoundingClientRect();return r.left>=c.left&&r.right<=c.right;}"))
        editor.press("Escape")
        self.open("#parameters/lighting")
        self.page.locator("table").evaluate("""table => {
          const headers=[...table.tHead.rows[0].cells];table.style.tableLayout='fixed';table.style.width=`${headers.length*100}px`;
          headers.forEach(th=>th.style.width='100px');
        }""")
        self.page.get_by_role("button", name=re.compile(r"^Entry lights for Living room:")).click()
        choices = self.page.get_by_role("dialog", name="Entry lights for Living room", exact=True)
        choices.wait_for()
        self.assertGreater(choices.get_by_role("checkbox").count(), 0)
        self.assertTrue(choices.evaluate("e=>{const r=e.getBoundingClientRect();return !e.closest('table')&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}"))
        choices.get_by_role("button", name="Done", exact=True).click()


if __name__ == "__main__":
    unittest.main(verbosity=2)
