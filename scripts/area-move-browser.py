"""Area moves against an intercepted hierarchy; no request writes reach the server."""
import copy, json, os, re, unittest, urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_common import BASE, launch, screenshot_dir

class AreaMove(unittest.TestCase):
    def test_move_and_direct_confirmation(self):
        with urllib.request.urlopen(os.environ.get('TAXIS_FIXTURE_URL', BASE) + '/api/hierarchy', timeout=10) as response: body = json.load(response)
        h = body['hierarchy']
        area = copy.deepcopy(next(iter(h['areas'].values())))
        label = copy.deepcopy(next(iter(h['labels'].values())))
        h['labels'] = {key: {**label, 'id': key, 'name': name} for key, name in [('office', 'Space: Office'), ('studio', 'Space: Studio'), ('empty', 'Space: Empty'), ('other', 'Important')]}
        rows = [('coffee', 'Coffee', 'first', ['office', 'other']), ('studio_area', 'Studio area', 'second', ['studio']), ('loose', 'Loose', None, [])]
        h['areas'] = {key: {**area, 'id': key, 'name': name, 'floorId': floor, 'labels': labels, 'entityIds': [], 'deviceIds': []} for key, name, floor, labels in rows}
        h['floors'] = [{'id': 'first', 'name': 'First', 'level': 0, 'areaIds': ['coffee']}, {'id': 'second', 'name': 'Second', 'level': 1, 'areaIds': ['studio_area']}]
        h['looseAreaIds'] = ['loose']; h['entities'] = {}; h['devices'] = {}; h['unassignedEntityIds'] = []
        submitted = []; previews = []; applied = []; mode = {'review': True}
        with sync_playwright() as p:
            browser = launch(p); context = browser.new_context(viewport={'width': 1600, 'height': 1000}); page = context.new_page()
            def guard(route):
                if route.request.method not in ('GET', 'HEAD', 'OPTIONS'): self.fail('Unexpected write: ' + route.request.url)
                route.continue_()
            page.route('**/api/**', guard)
            page.route('**/api/hierarchy*', lambda r: r.fulfill(json=body))
            page.route('**/api/settings/general', lambda r: r.fulfill(json={'ok': True, 'general': {'reviewChangesBeforeApplying': mode['review']}, 'revision': 'mock', 'directEditingAvailable': True}))
            def changes(route):
                if route.request.method == 'POST': submitted.append(route.request.post_data_json)
                route.fulfill(json={'ok': True, 'changes': [], 'version': 'mock'})
            page.route('**/api/changes', changes)
            def preview(route):
                inputs = route.request.post_data_json['changes']; previews.extend(inputs)
                planned = [{'id': i + 1, 'kind': item['kind'], 'op': item['op'], 'targetId': item['targetId'], 'scope': None, 'before': {}, 'after': item['fields'], 'createdAt': ''} for i, item in enumerate(inputs)]
                route.fulfill(json={'ok': True, 'changes': planned, 'previewVersion': 'mock', 'requiresNoBackupConfirmation': False})
            page.route('**/api/direct-preview', preview)
            def direct(route):
                applied.append(route.request.post_data_json)
                route.fulfill(json={'ok': True, 'results': [], 'applied': 1, 'failed': 0})
            page.route('**/api/direct-changes', direct)
            page.goto(BASE + '/#home', wait_until='networkidle')
            nav = page.get_by_role('navigation', name='Floors and areas')
            page.screenshot(path=str(screenshot_dir() / 'area-move-initial.png'))
            coffee = nav.get_by_role('button', name='Coffee 0', exact=True)
            def start_drag(source):
                box = source.bounding_box(); page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); page.mouse.down()
                page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2 + 15, steps=5)
                expect(nav.get_by_text('Drop on a floor to keep the Space', exact=False)).to_be_visible()
            def hover(destination):
                box = destination.bounding_box(); page.mouse.move(box['x'] + 20, box['y'] + 10, steps=8)
                page.mouse.move(box['x'] + 21, box['y'] + 10)
                expect(destination.locator('..')).to_have_class(re.compile('ring-2'))
            def drag(source, destination):
                start_drag(source); hover(destination)
                page.mouse.up()
            coffee.click()
            drag(coffee.get_by_title('Drag to a floor or Space'), nav.get_by_role('button', name='Second', exact=True))
            page.wait_for_timeout(500)
            self.assertEqual(submitted[-1], {'kind': 'area', 'op': 'update', 'targetId': 'coffee', 'fields': {'floor_id': 'second'}})
            expect(coffee).to_have_attribute('aria-current', 'true')
            second = nav.get_by_role('button', name='Second', exact=True)
            second.click(); expect(second).to_have_attribute('aria-expanded', 'false'); coffee.click()
            start_drag(coffee); hover(second)
            expect(second).to_have_attribute('aria-expanded', 'true')
            page.mouse.move(1, 1, steps=8); page.mouse.up()
            expect(second).to_have_attribute('aria-expanded', 'false')
            start_drag(coffee); hover(second)
            hover(nav.get_by_role('button', name='Studio', exact=True).nth(1)); page.mouse.up()
            page.wait_for_timeout(500)
            self.assertEqual(submitted[-1]['fields'], {'floor_id': 'second', 'labels': ['other', 'studio']})
            self.assertEqual(submitted[-1]['areaMove']['spaceLabelId'], 'studio')
            search = page.get_by_placeholder('Find an area or entity')
            search.fill('Coffee')
            expect(second).to_have_count(0)
            start_drag(coffee)
            expect(second).to_be_visible()
            page.mouse.move(1, 1, steps=8); page.mouse.up()
            search.fill('')
            drag(coffee, nav.get_by_role('button', name='Empty', exact=True).nth(1))
            page.wait_for_timeout(500)
            self.assertEqual(submitted[-1]['fields'], {'floor_id': 'second', 'labels': ['other', 'empty']})
            drag(coffee, nav.get_by_role('button', name='No Space', exact=True).last)
            page.wait_for_timeout(500)
            self.assertEqual(submitted[-1]['fields'], {'floor_id': None, 'labels': ['other']})
            count = len(submitted)
            drag(coffee, nav.get_by_role('button', name='First', exact=True))
            expect(nav.get_by_role('alert')).to_contain_text('already in this location')
            self.assertEqual(len(submitted), count)
            nav.get_by_role('button', name='Second', exact=True).evaluate("element => { const d = new DataTransfer(); d.setData('application/x-taxis-area', 'coffee'); element.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer:d})); element.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:d})); }")
            page.wait_for_timeout(200)
            self.assertEqual(len(submitted), count)
            nav.get_by_role('button', name='Move Coffee').click()
            select = nav.get_by_label('Move destination')
            expect(select).to_be_focused()
            select.select_option(label='Second · Studio')
            page.screenshot(path=str(screenshot_dir() / 'area-move-menu.png'))
            mode['review'] = False; page.reload(wait_until='networkidle')
            nav.get_by_role('button', name='Move Coffee').click()
            nav.get_by_label('Move destination').select_option(label='Second · Studio')
            nav.get_by_role('region', name='Move Coffee').get_by_role('button', name='Move', exact=True).click()
            dialog = page.get_by_role('dialog', name='Review before applying'); expect(dialog).to_be_visible()
            self.assertEqual(previews[-1]['fields'], {'floor_id': 'second', 'labels': ['other', 'studio']})
            dialog.get_by_role('button', name='Cancel').click()
            self.assertEqual(applied, [])
            expect(coffee).to_have_attribute('aria-current', 'true')
            nav.get_by_role('region', name='Move Coffee').get_by_role('button', name='Move', exact=True).click()
            expect(dialog).to_contain_text('installed members and settings are not updated')
            dialog.get_by_role('button', name='Confirm and apply').click()
            page.wait_for_timeout(500)
            self.assertEqual(applied[-1]['changes'][0]['fields'], {'floor_id': 'second', 'labels': ['other', 'studio']})
            self.assertEqual(applied[-1]['changes'][0]['areaMove']['spaceLabelId'], 'studio')
            context.close(); browser.close()

if __name__ == '__main__': unittest.main()
