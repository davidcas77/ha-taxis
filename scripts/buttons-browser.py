"""Button mapping flows against the dummy HA. All writes and paid calls intercepted."""
import copy
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import unittest
import urllib.request

spec = importlib.util.spec_from_file_location('guide_fixture', Path(__file__).with_name('guide-browser.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class ButtonsRegression(fixture.GuideRegression):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if cls.original['hierarchy']['home']['name'] != 'Demo House':
            raise RuntimeError('Use the isolated dummy HA only')
        with urllib.request.urlopen(fixture.BASE + '/api/buttons', timeout=30) as response:
            cls.button_original = json.load(response)
        if not any(c['id'] == 'device:demo_wall_buttons' for c in cls.button_original['inventory']['controls']):
            raise RuntimeError('Start the current mock with button demonstration data')

    def setUp(self):
        super().setUp()
        self.inv = copy.deepcopy(self.button_original['inventory'])
        self.inv['controls'] = [c for c in self.inv['controls'] if c['id'].startswith('device:demo_')]
        self.inv['managed'], self.inv['notes'] = [], []
        self.inv['coverage'] = {'automations': 1, 'readable': 1, 'unreadable': 0}
        self.inv['controls'].append({'id': 'device:unknown', 'deviceId': 'unknown', 'name': 'Unexposed keypad', 'areaId': None, 'manufacturer': 'Fixture', 'model': 'Keypad', 'integrations': ['other'], 'gestures': [], 'notes': ['No button metadata returned.'], 'existing': {}})
        base = copy.deepcopy(next(iter(self.original['hierarchy']['devices'].values())))
        for c in self.inv['controls']:
            self.body['hierarchy']['devices'][c['deviceId']] = {**base, 'id': c['deviceId'], 'name': c['name'], 'areaId': c['areaId'], 'entityIds': []}
        self.add_entity('light.living_all', 'light', platform='group', members=['light.living_bulb'])
        self.add_entity('script.goodnight', 'automation')
        self.queue_calls, self.ai_calls, self.ai_previews = [], [], []
        self.fail_queue = False
        self.fingerprint = 'a' * 64
        self.page.route('**/api/buttons*', lambda r: r.fulfill(json={'ok': True, 'inventory': self.inv, 'fingerprint': self.fingerprint}))
        self.page.route('**/api/changes', lambda r: r.fulfill(json={'ok': True, 'changes': self.queued, 'version': f'{len(self.queue_calls):016x}'}))
        def queue(route):
            body = route.request.post_data_json
            self.queue_calls.append(body)
            c = next(c for c in self.inv['controls'] if c['id'] == body['controlId'])
            g = next(g for g in c['gestures'] if g['key'] == body['gestureKey'])
            conflicts = c['existing'].get(g['key'], [])
            if self.fail_queue or (conflicts or self.inv['coverage']['unreadable']) and not body['allowExisting']:
                route.fulfill(status=409, json={'ok': False, 'error': 'Existing or unreadable automations may handle this button. Review coexistence first.'})
                return
            output = body['action']['entityId'] or 'service:' + body['action']['service']
            digest = hashlib.sha256(json.dumps(output, separators=(',', ':')).encode()).hexdigest()[:20]
            target = 'taxis_buttons_' + digest
            old = next((v for v in self.queued if v['targetId'] == target), None)
            key = hashlib.sha256(json.dumps([c['id'], g['key']], separators=(',', ':')).encode()).hexdigest()[:24]
            binding = {'key': key, 'controlId': c['id'], 'gestureKey': g['key'], 'button': g['button'], 'gesture': g['gesture'], 'trigger': g['trigger'], 'action': body['action'], 'enabled': body['enabled']}
            for k in ['eventEntity', 'eventType']:
                if k in g:
                    binding[k] = g[k]
            mappings = [b for b in old['after']['button_map']['bindings'] if b['key'] != key] if old else []
            mappings.append(binding)
            after = {'automation_id': target, 'alias': 'Taxis buttons · ' + output, 'button_map': {'version': 1, 'output': output, 'bindings': mappings, 'expected': None, 'allowExisting': body['allowExisting']}}
            if old:
                old['after'] = after
            else:
                self.queued.append({'id': len(self.queued) + 1, 'kind': 'automation', 'op': 'create', 'targetId': target, 'scope': None, 'before': {}, 'after': after, 'createdAt': '2026-10-28T00:00:00Z'})
            route.fulfill(json={'ok': True, 'changes': self.queued, 'version': f'{len(self.queue_calls):016x}'})
        self.page.route('**/api/buttons/assign', queue)
        def ai_preview(route):
            self.ai_previews.append(route.request.url)
            route.fulfill(json={'ok': True, 'preview': {'content': '{"control":"Selected fixture","matches":1}', 'fingerprint': 'b' * 64, 'count': 1}})
        self.page.route('**/api/buttons/*/ai-preview', ai_preview)
        def ai_review(route):
            self.ai_calls.append(route.request.post_data_json)
            route.fulfill(json={'ok': True, 'model': 'middle-fixture', 'text': 'Review the existing trigger before adding a second handler.'})
        self.page.route('**/api/buttons/*/ai-review', ai_review)

    def open_control(self, id='demo_wall_buttons'):
        self.page.goto(fixture.BASE + '/#buttons/' + 'device%3A' + id, wait_until='networkidle')
        self.page.get_by_role('heading', name='Buttons', exact=True).wait_for()
        c = next(c for c in self.inv['controls'] if c['deviceId'] == id)
        self.page.get_by_role('heading', name=c['name'], exact=True).wait_for()

    def row(self, button='Right', gesture='Short Press', source='aqara device trigger'):
        return self.page.get_by_role('region', name='Button ' + button, exact=True).get_by_role('group', name=gesture + ' · ' + source, exact=True)

    def editor(self, row, target='light.living_all', service='light.toggle'):
        row.get_by_role('button', name='Assign action', exact=True).click()
        form = row.get_by_role('form')
        form.get_by_label('Button action target', exact=True).select_option(target)
        form.get_by_label('Button action service', exact=True).select_option(service)
        return form

    def save(self, form):
        form.get_by_role('button', name='Add to changes', exact=True).click()
        self.page.get_by_role('status').filter(has_text='Button mapping queued').wait_for()

    def test_buttons_across_integrations_and_combined_presses_are_visible_without_writes(self):
        self.open_control()
        self.assertTrue(self.page.get_by_role('region', name='Button Both', exact=True).is_visible())
        for label in ['Short Press', 'Double Press', 'Long Press']:
            self.assertTrue(self.row(gesture=label).is_visible())
        sidebar = self.page.get_by_role('complementary', name='Button controls')
        for label in ['Six-button remote', 'Matter bedside button', 'Bedroom wall control']:
            self.assertTrue(sidebar.get_by_role('button', name=re.compile('^' + label)).is_visible())
        self.assertEqual(self.queue_calls + self.ai_calls + self.posts + self.puts, [])

    def test_buttons_three_inputs_share_one_group_map_with_on_off_toggle(self):
        self.open_control()
        for gesture, service in [('Short Press', 'light.turn_on'), ('Double Press', 'light.turn_off'), ('Long Press', 'light.toggle')]:
            self.save(self.editor(self.row(gesture=gesture), service=service))
        self.assertEqual(len(self.queued), 1)
        mappings = self.queued[0]['after']['button_map']['bindings']
        self.assertEqual({b['action']['service'] for b in mappings}, {'light.turn_on', 'light.turn_off', 'light.toggle'})
        self.assertEqual(len(mappings), 3)
        self.assertEqual(self.posts + self.puts, [])

    def test_buttons_reverse_view_shows_all_controls_for_one_output(self):
        self.open_control()
        self.save(self.editor(self.row()))
        self.page.get_by_role('complementary', name='Button controls').get_by_role('button', name=re.compile('^Six-button remote')).click()
        self.save(self.editor(self.row(button='1', source='mqtt device trigger')))
        self.page.get_by_role('button', name='By output', exact=True).click()
        self.page.get_by_role('complementary', name='Button controls').get_by_role('button', name=re.compile('light.living_all')).click()
        table = self.page.get_by_role('table', name='Buttons controlling output')
        self.assertIn('Bedroom wall control', table.inner_text())
        self.assertIn('Six-button remote', table.inner_text())
        self.assertEqual(len(self.queued), 1)

    def test_buttons_existing_handler_is_shown_and_a_new_handler_is_blocked(self):
        self.open_control()
        row = self.row(button='Left')
        self.assertIn('Existing wall button toggle', row.inner_text())
        form = self.editor(row)
        form.get_by_role('button', name='Add to changes', exact=True).click()
        form.get_by_role('alert').wait_for()
        self.assertEqual(self.queued, [])
        self.assertEqual(form.get_by_label('Button action target').input_value(), 'light.living_all')

    def test_buttons_edit_replaces_the_assignment_and_can_disable_it(self):
        self.open_control()
        row = self.row()
        self.save(self.editor(row))
        row.get_by_role('button', name='Edit assignment', exact=True).click()
        form = row.get_by_role('form')
        form.get_by_label('Button action service').select_option('light.turn_off')
        form.get_by_role('checkbox', name='Enable this assignment after Apply').uncheck()
        self.save(form)
        self.assertEqual(len(self.queued[0]['after']['button_map']['bindings']), 1)
        self.assertFalse(self.queued[0]['after']['button_map']['bindings'][0]['enabled'])

    def test_buttons_support_scripts_and_service_actions_with_json_data(self):
        self.open_control()
        form = self.editor(self.row(), target='script.goodnight', service='script.turn_on')
        form.locator('summary').click()
        form.get_by_label('Button action data').fill('{"variables":{"room":"bedroom"}}')
        self.save(form)
        self.assertEqual(self.queue_calls[0]['action']['data'], {'variables': {'room': 'bedroom'}})
        form = self.editor(self.row(gesture='Double Press'), target='', service='persistent_notification.create')
        self.assertNotIn('light.turn_on', form.get_by_label('Button action service').inner_text())
        self.save(form)
        self.assertEqual(len(self.queued), 2)

    def test_buttons_invalid_data_never_queues_or_executes_anything(self):
        self.open_control()
        form = self.editor(self.row())
        form.locator('summary').click()
        form.get_by_label('Button action data').fill('{"entity_id":"all"}')
        form.get_by_role('button', name='Add to changes').click()
        form.get_by_role('alert').wait_for()
        self.assertEqual(self.queue_calls + self.posts + self.puts, [])

    def test_buttons_unsaved_assignment_survives_cancelled_navigation_and_view_switch(self):
        self.open_control()
        form = self.editor(self.row())
        self.page.once('dialog', lambda d: d.dismiss())
        self.page.get_by_role('button', name='By output', exact=True).click()
        self.assertTrue(form.is_visible())
        self.page.once('dialog', lambda d: d.dismiss())
        self.page.get_by_role('navigation', name='Pages').get_by_role('button', name='Areas', exact=True).click()
        self.assertTrue(form.is_visible())

    def test_buttons_missing_metadata_is_explicit_and_does_not_invent_clicks(self):
        self.open_control('unknown')
        self.assertIn('HA did not expose button gestures', self.page.get_by_role('main').inner_text())
        self.assertEqual(self.page.get_by_role('button', name='Assign action', exact=True).count(), 0)

    def test_buttons_ai_is_manual_and_has_a_reviewable_payload(self):
        self.open_control()
        self.page.get_by_text('AI review of existing button automations', exact=True).click()
        self.assertEqual(self.ai_calls, [])
        self.page.get_by_role('button', name='Prepare AI preview', exact=True).click()
        self.page.get_by_text('{"control":"Selected fixture","matches":1}', exact=True).wait_for()
        self.assertEqual(self.ai_calls, [])
        self.page.get_by_role('button', name='Send this review to Medium AI', exact=True).click()
        self.page.get_by_text('Review the existing trigger before adding a second handler.', exact=False).wait_for()
        self.assertEqual(self.ai_calls, [{'fingerprint': 'b' * 64}])
        self.assertEqual(self.queued, [])

    def test_buttons_changes_review_explains_the_grouped_map(self):
        self.open_control()
        self.save(self.editor(self.row()))
        self.page.get_by_role('button', name='Review changes', exact=True).click()
        self.page.get_by_role('heading', name='Changes', exact=True).wait_for()
        self.assertIn('button automation', self.page.get_by_role('main').inner_text())
        self.assertIn('Short Press', self.page.get_by_role('main').inner_text())
        self.assertIn('light.toggle', self.page.get_by_role('main').inner_text())
        self.assertNotIn('recipe for undefined', self.page.get_by_role('main').inner_text())

    def test_buttons_mobile_layout_fits_and_desktop_screenshot_is_readable(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.open_control()
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
        form = self.editor(self.row())
        self.assertLessEqual(form.bounding_box()['width'], 390)
        self.page.once('dialog', lambda d: d.accept())
        form.get_by_role('button', name='Cancel', exact=True).click()
        self.page.set_viewport_size({'width': 1600, 'height': 1100})
        self.page.get_by_role('heading', name='Bedroom wall control', exact=True).scroll_into_view_if_needed()
        screenshot_dir = os.environ.get('TAXIS_SCREENSHOT_DIR')
        if screenshot_dir:
            Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(screenshot_dir) / 'buttons-page.png'))


if __name__ == '__main__':
    unittest.main(testLoader=type('ButtonsLoader', (unittest.TestLoader,), {'testMethodPrefix': 'test_buttons_'})())
