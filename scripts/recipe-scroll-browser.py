"""Recipe scrolling and navigation with a mocked hierarchy; no settings writes."""
import copy
import json
import unittest
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_common import BASE, launch, screenshot_dir


class RecipeScrollRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + '/api/hierarchy', timeout=30) as response:
            cls.base = json.load(response)
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 650})
        self.page = self.context.new_page()
        self.page.set_default_timeout(30000)
        body = copy.deepcopy(self.base)
        h = body['hierarchy']
        area = next(iter(h['areas'].values()))
        h['areas'] = {f'fixture{i}': {**area, 'id': f'fixture{i}', 'name': f'Fixture area {i:02}', 'floorId': 'fixture', 'entityIds': [], 'deviceIds': []} for i in range(35)}
        h['floors'] = [{'id': 'fixture', 'name': 'Fixture floor', 'level': 0, 'areaIds': list(h['areas'])}]
        h['looseAreaIds'] = []
        h['devices'] = {}
        h['entities'] = {}
        h['unassignedEntityIds'] = []
        self.page.route('**/api/hierarchy*', lambda route: route.fulfill(json=body))
        self.page.route('**/api/recipes/state', lambda route: route.fulfill(json={'ok': True, 'installed': {'blueprints': {}, 'automations': {}, 'scripts': {}, 'timers': {}, 'controllers': {}}}))
        self.page.route('**/api/**', lambda route: route.abort() if route.request.method not in ('GET', 'HEAD') else route.fallback())

    def tearDown(self):
        self.context.close()

    def open_recipe(self, name):
        self.page.goto(BASE + '/#automations/recipes', wait_until='domcontentloaded')
        self.page.get_by_role('table', name='Recipe types').get_by_role('button', name=name, exact=True).click()
        return self.page.get_by_role('article', name='Recipe details')

    def test_desktop_independent_scrolling(self):
        details = self.open_recipe('Occupancy')
        recipes = self.page.get_by_role('region', name='Records')
        header = details.get_by_role('tablist', name='Recipe details sections')
        description = details.get_by_role('tabpanel', name='Description')
        before = [x.bounding_box()['y'] for x in (recipes, header)]
        self.assertGreater(description.evaluate('(e) => e.scrollHeight - e.clientHeight'), 0)
        description.evaluate('(e) => e.scrollTop = e.scrollHeight')
        self.assertGreater(description.evaluate('(e) => e.scrollTop'), 0)
        self.assertEqual(before, [x.bounding_box()['y'] for x in (recipes, header)])
        details.get_by_role('tab', name='Availability').click()
        nav = details.get_by_role('navigation', name='Recipe areas')
        content = nav.locator('xpath=following-sibling::div')
        before = [x.bounding_box()['y'] for x in (recipes, header, nav)]
        self.assertGreater(content.evaluate('(e) => e.scrollHeight - e.clientHeight'), 0)
        content.evaluate('(e) => e.scrollTop = e.scrollHeight')
        self.assertGreater(content.evaluate('(e) => e.scrollTop'), 0)
        self.assertEqual(before, [x.bounding_box()['y'] for x in (recipes, header, nav)])
        self.assertGreater(nav.evaluate('(e) => e.scrollHeight - e.clientHeight'), 0)
        nav.evaluate('(e) => e.scrollTop = e.scrollHeight')
        self.assertGreater(nav.evaluate('(e) => e.scrollTop'), 0)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.page.screenshot(path=str(screenshot_dir() / 'recipe-scroll-desktop.png'))

    def test_motion_and_house_scrolling(self):
        for name, nav_name in [('Motion lights', 'Motion lights areas'), ('House presence', 'Recipe scopes')]:
            details = self.open_recipe(name)
            details.get_by_role('tab', name='Availability').click()
            nav = details.get_by_role('navigation', name=nav_name, exact=True)
            if name == 'House presence': nav.get_by_role('button', name='All areas (legacy)').click()
            content = nav.locator('xpath=following-sibling::div')
            fixed = [self.page.get_by_role('region', name='Records'), details.get_by_role('tablist'), nav]
            before = [element.bounding_box()['y'] for element in fixed]
            self.assertGreater(content.evaluate('(e) => e.scrollHeight - e.clientHeight'), 0, name)
            content.evaluate('(e) => e.scrollTop = e.scrollHeight')
            self.assertGreater(content.evaluate('(e) => e.scrollTop'), 0, name)
            self.assertEqual(before, [element.bounding_box()['y'] for element in fixed])
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

    def test_scroll_into_view_and_keyboard_focus_keep_header(self):
        details = self.open_recipe('Occupancy')
        details.get_by_role('tab', name='Availability').click()
        nav = details.get_by_role('navigation', name='Recipe areas')
        title = details.get_by_role('heading', name='Occupancy', exact=True)
        tabs = details.get_by_role('tablist', name='Recipe details sections')
        fixed = [self.page.get_by_role('region', name='Records'), title, tabs, nav]
        before = [element.bounding_box()['y'] for element in fixed]
        helpers = details.get_by_role('table', name='Recipe helpers')
        helpers.scroll_into_view_if_needed()
        self.assertEqual(before, [element.bounding_box()['y'] for element in fixed])
        self.page.screenshot(path=str(screenshot_dir() / 'recipe-helpers-scroll.png'))
        button = details.get_by_role('table', name='Area parameters').get_by_role('button').last
        button.focus()
        self.assertEqual(before, [element.bounding_box()['y'] for element in fixed])
        self.page.keyboard.press('Tab')
        self.assertEqual(before, [element.bounding_box()['y'] for element in fixed])

    def test_mobile_navigation(self):
        self.page.set_viewport_size({'width': 390, 'height': 700})
        details = self.open_recipe('Motion lights')
        details.get_by_role('tab', name='Availability').click()
        nav = details.get_by_role('navigation', name='Motion lights areas')
        nav.get_by_role('button', name='Fixture area 00').click()
        expect(details.get_by_role('button', name='← Back to areas')).to_be_visible()
        details.get_by_role('button', name='← Back to areas').click()
        expect(nav).to_be_visible()
        details.get_by_role('button', name='← Back to recipes').click()
        expect(self.page.get_by_role('table', name='Recipe types')).to_be_visible()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.page.screenshot(path=str(screenshot_dir() / 'recipe-scroll-mobile.png'))


if __name__ == '__main__':
    unittest.main()
