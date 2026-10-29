"""Read-only compact Organize navigation checks against the built mock preview."""
import os
import re
import unittest
from playwright.sync_api import sync_playwright
from browser_common import BASE, launch, screenshot_dir



class OrganizeSidebarRegression(unittest.TestCase):
    def test_background_toggle_icons_navigation_and_persistence(self):
        with sync_playwright() as p:
            browser = launch(p)
            context = browser.new_context(viewport={"width": 1600, "height": 1100}, color_scheme="dark")
            page = context.new_page()
            page.set_default_timeout(60000)
            page.set_default_navigation_timeout(60000)
            try:
                page.goto(BASE + "/#organize/entities", wait_until="domcontentloaded")
                nav = page.get_by_role("navigation", name="What to organize", exact=True)
                nav.get_by_role("button", name="Collapse Organize sidebar", exact=True).wait_for()
                expanded = nav.bounding_box()["width"]
                nav.click(position={"x": expanded/2, "y": nav.bounding_box()["height"]-20})
                nav.get_by_role("button", name="Expand Organize sidebar", exact=True).wait_for()
                self.assertLess(nav.bounding_box()["width"], expanded-50)
                names = ["Floors and areas", "Labels", "Automation categories", "Script categories", "Scene categories", "Helper categories", "Zones", "Automations", "Blueprints", "Devices", "Entities", "Helpers"]
                for name in names:
                    button = nav.get_by_role("button", name=re.compile(r"^"+re.escape(name)+r"\b"))
                    self.assertEqual(button.locator("svg").count(), 1, name)
                    icon = button.locator("svg").bounding_box()
                    label = button.locator("span").first.bounding_box()
                    self.assertGreaterEqual(label["y"], icon["y"]+icon["height"]-1, name)
                nav.get_by_role("button", name=re.compile(r"^Helpers\b")).click()
                page.wait_for_function("location.hash === '#organize/helpers'")
                self.assertTrue(nav.get_by_role("button", name="Expand Organize sidebar", exact=True).is_visible())
                page.reload(wait_until="domcontentloaded")
                nav.get_by_role("button", name="Expand Organize sidebar", exact=True).wait_for()
                page.screenshot(path=str(screenshot_dir() / "organize-compact.png"))
                nav.click(position={"x": nav.bounding_box()["width"]/2, "y": nav.bounding_box()["height"]-20})
                nav.get_by_role("button", name="Collapse Organize sidebar", exact=True).wait_for()
                self.assertAlmostEqual(nav.bounding_box()["width"], expanded, delta=1)
                toggle = nav.get_by_role("button", name="Collapse Organize sidebar", exact=True)
                toggle.focus()
                page.keyboard.press("Enter")
                nav.get_by_role("button", name="Expand Organize sidebar", exact=True).wait_for()
            finally:
                context.close()
                browser.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
