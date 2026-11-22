"""Button mapping flows against the dummy HA. All writes and paid calls intercepted."""
import copy
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import unittest
from playwright.sync_api import expect
import urllib.request
from urllib.parse import unquote, urlsplit

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
        self.ai_results = []
        self.ai_preview = {'content': '{"control":"Selected fixture","matches":1}', 'fingerprint': 'b' * 64, 'count': 1}
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
            route.fulfill(json={'ok': True, 'preview': self.ai_preview})
        self.page.route('**/api/buttons/*/ai-preview', ai_preview)
        def ai_review(route):
            self.ai_calls.append(route.request.post_data_json)
            if self.ai_results:
                status, body = self.ai_results.pop(0)
                route.fulfill(status=status, json=body)
            else:
                route.fulfill(json={'ok': True, 'model': 'middle-fixture', 'text': 'Review the existing trigger before adding a second handler.'})
        self.page.route('**/api/buttons/*/ai-review', ai_review)
        self.reference_rows, self.reference_calls = {}, []
        def references(route):
            path = unquote(urlsplit(route.request.url).path).split("/")
            control_id = path[-2] if path[-1] == "references" else path[-3]
            rows = self.reference_rows.setdefault(control_id, [])
            method = route.request.method
            if method == "GET":
                route.fulfill(json={"ok": True, "references": rows})
                return
            body = route.request.post_data_json
            self.reference_calls.append((method, control_id, path[-1], body))
            if method == "POST":
                rows.append({**body, "id": "24d5e061-6d13-4353-bfc6-8d909bf5864f", "revision": 1})
            elif method in ("PUT", "DELETE"):
                note = next((item for item in rows if item["id"] == path[-1] and item["revision"] == body["revision"]), None)
                if note is None:
                    route.fulfill(status=409, json={"ok": False, "error": "This button note changed or was removed."})
                    return
                if method == "PUT":
                    note.update({**body, "revision": body["revision"] + 1})
                else:
                    rows.remove(note)
            route.fulfill(json={"ok": True, "references": rows})
        self.page.route(re.compile(r"/api/buttons/[^/]+/references(?:/[^/]+)?$"), references)

    def open_control(self, id='demo_wall_buttons'):
        self.page.goto(fixture.BASE + '/#automations/buttons/' + 'device%3A' + id, wait_until='networkidle')
        self.page.get_by_role('heading', name='Buttons', exact=True).wait_for()
        c = next(c for c in self.inv['controls'] if c['deviceId'] == id)
        self.page.get_by_role('heading', name=c['name'], exact=True).wait_for()

    def table(self, control='Bedroom wall control'):
        # One table per control: a row for each button, a column for each press type.
        return self.page.get_by_role('table', name='Buttons of ' + control, exact=True)

    def row(self, button='Right', gesture='Short press', source='aqara device trigger', control='Bedroom wall control'):
        """The cell of one button and press type: its assignments, the handlers that exist, and the +."""
        line = self.table(control).locator('tbody tr').filter(has=self.page.get_by_text(button, exact=True))
        return line.get_by_role('group', name=gesture + ' · ' + source, exact=True)

    def editor(self, row, target='light.living_all', service='light.toggle'):
        row.get_by_role('button', name=re.compile(r'^Assign action to ')).click()
        form = self.page.get_by_role('form', name=re.compile(r'^Assign '))
        form.get_by_label('Button action target', exact=True).select_option(target)
        form.get_by_label('Button action service', exact=True).select_option(service)
        return form

    def save(self, form):
        form.get_by_role('button', name='Add to changes', exact=True).click()
        self.page.get_by_role('status').filter(has_text='Button mapping added to changes').first.wait_for()
        # An earlier notice can still be on screen; the form closing is what says this one went in.
        expect(form).to_have_count(0)

    def test_buttons_header_keeps_bookmarked_control_selected(self):
        self.open_control()
        header = self.page.get_by_role('navigation', name='Pages')
        buttons = header.get_by_role('button', name='Buttons', exact=True)
        expect(buttons).to_have_attribute('aria-current', 'page')
        buttons.click()
        expect(self.page).to_have_url(fixture.BASE + '/#automations/buttons/device%3Ademo_wall_buttons')
        expect(self.table()).to_be_visible()

    def test_buttons_direct_assignment_requires_exact_confirmation(self):
        self.page.route('**/api/settings/general', lambda route: route.fulfill(json={'ok': True, 'general': {'reviewChangesBeforeApplying': False}, 'revision': 'direct-revision'}))
        calls = []
        preview = {'ok': True, 'previewVersion': 'button-preview', 'requiresNoBackupConfirmation': False, 'changes': [{'id': 1, 'kind': 'automation', 'op': 'create', 'targetId': 'taxis_buttons_fixture', 'scope': None, 'before': {}, 'after': {'action': 'light.toggle'}, 'createdAt': ''}]}
        self.page.route('**/api/buttons/preview-assignment', lambda route: route.fulfill(json=preview))
        def direct(route):
            calls.append(route.request.post_data_json)
            route.fulfill(json={'ok': True, 'backup': {'made': False}, 'results': [{'changeId': 1, 'ok': True, 'status': 'verified', 'message': 'Applied'}]})
        self.page.route('**/api/buttons/assign', direct)
        self.open_control()
        form = self.editor(self.row())
        form.get_by_role('button', name='Apply assignment').click()
        dialog = self.page.get_by_role('dialog', name='Review before applying')
        self.assertIn('taxis_buttons_fixture', dialog.inner_text())
        self.assertEqual(calls, [])
        self.assertEqual(dialog.get_by_role('checkbox').count(), 0)
        dialog.get_by_role('button', name='Confirm and apply').click()
        self.page.get_by_role('status').filter(has_text='Button mapping applied to Home Assistant').wait_for()
        self.assertNotIn('allowWithoutBackup', calls[0])
        self.assertEqual(calls[0]['previewVersion'], 'button-preview')
        self.assertEqual(calls[0]['settingsRevision'], 'direct-revision')
        self.assertEqual(self.posts + self.puts, [])

    def test_buttons_direct_assignment_partial_failure_stays_visible(self):
        self.page.route('**/api/settings/general', lambda route: route.fulfill(json={'ok': True, 'general': {'reviewChangesBeforeApplying': False}, 'revision': 'direct-revision'}))
        self.page.route('**/api/buttons/preview-assignment', lambda route: route.fulfill(json={'ok': True, 'previewVersion': 'button-preview', 'requiresNoBackupConfirmation': False, 'changes': []}))
        calls = []
        def direct(route):
            calls.append(route.request.post_data_json)
            route.fulfill(json={'ok': True, 'backup': {'made': False, 'reason': 'Taxis did not make a backup.'}, 'results': [{'changeId': 1, 'ok': True, 'status': 'partial', 'message': 'Assignment applied with a problem.', 'details': ['Manual repair required.']}]})
        self.page.route('**/api/buttons/assign', direct)
        self.open_control()
        form = self.editor(self.row())
        form.get_by_role('button', name='Apply assignment').click()
        self.page.get_by_role('dialog', name='Review before applying').get_by_role('button', name='Confirm and apply').click()
        self.page.get_by_role('alert').filter(has_text='Manual repair required.').wait_for()
        self.assertTrue(form.is_visible())
        self.assertEqual(calls[0]['settingsRevision'], 'direct-revision')
        self.assertEqual(self.posts + self.puts, [])

    def test_buttons_across_integrations_and_combined_presses_are_visible_without_writes(self):
        self.open_control()
        self.assertTrue(self.table().locator('tbody tr').filter(has=self.page.get_by_text('Both', exact=True)).is_visible())
        for label in ['Short press', 'Double press', 'Long press']:
            self.assertTrue(self.row(gesture=label).is_visible())
        sidebar = self.page.get_by_role('complementary', name='Button controls')
        for label in ['Six-button remote', 'Matter bedside button', 'Bedroom wall control']:
            self.assertTrue(sidebar.get_by_role('button', name=re.compile('^' + label)).is_visible())
        self.assertEqual(self.queue_calls + self.ai_calls + self.posts + self.puts, [])

    def test_buttons_three_inputs_share_one_group_map_with_on_off_toggle(self):
        self.open_control()
        for gesture, service in [('Short press', 'light.turn_on'), ('Double press', 'light.turn_off'), ('Long press', 'light.toggle')]:
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
        self.save(self.editor(self.row(button='2', source='mqtt device trigger', control='Six-button remote')))
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
        row.get_by_role('button', name=re.compile(r'^Edit assignment of ')).click()
        form = self.page.get_by_role('form', name=re.compile(r'^Assign '))
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
        form = self.editor(self.row(gesture='Double press'), target='', service='persistent_notification.create')
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
        nav = self.page.get_by_role('navigation', name='Pages')
        nav.get_by_role('button', name='Tools', exact=True).click()
        nav.get_by_role('button', name='Areas', exact=True).click()
        self.assertTrue(form.is_visible())

    def test_buttons_missing_metadata_is_explicit_and_does_not_invent_clicks(self):
        self.open_control('unknown')
        self.assertIn('HA did not expose button gestures', self.page.get_by_role('main').inner_text())
        self.assertEqual(self.page.get_by_role('button', name=re.compile(r'^Assign action')).count(), 0)

    def test_buttons_ai_is_manual_and_has_a_reviewable_payload(self):
        self.open_control()
        self.page.get_by_text('Analyze with AI', exact=True).click()
        self.assertEqual(self.ai_calls, [])
        expect(self.page.get_by_label('AI request evidence')).to_have_text(self.ai_preview['content'])
        self.assertEqual(self.ai_calls, [])
        self.page.get_by_role('button', name='Send this review to Medium AI', exact=True).click()
        expect(self.page.get_by_role('region', name='AI analysis')).to_contain_text('Review the existing trigger before adding a second handler.')
        self.assertEqual(self.ai_calls, [{'fingerprint': 'b' * 64}])
        self.assertEqual(self.queued, [])

    def test_buttons_press_evidence_survives_an_unavailable_ai_provider(self):
        control = next(c for c in self.inv['controls'] if c['id'] == 'device:demo_wall_buttons')
        gesture = next(g for g in control['gestures'] if g['button'] == 'Left' and g['gesture'] == 'Short press')
        target = {'id': 'light.living_all', 'name': 'Living room lights'}
        handler = {'id': 'fixture_lights', 'name': 'Bedtime lights', 'enabled': True, 'match': 'exact', 'managed': False,
                   'conditions': ['After sunset'], 'notes': [], 'actions': [{'service': 'light.turn_on', 'targets': [target],
                        'conditions': ['Guest mode is off'], 'branches': ['Choose option 1'], 'via': ['via script.bedtime'], 'uncertain': False}]}
        possible = {**handler, 'id': 'fixture_other', 'name': 'Hall keypad behavior', 'match': 'possible', 'enabled': None, 'actions': []}
        self.ai_preview['analysis'] = {'control': {'name': control['name'], 'integrations': control['integrations']}, 'notes': [],
            'coverage': {'automations': 3, 'readable': 2, 'unreadable': 1}, 'related': [],
            'gestures': [{'key': gesture['key'], 'button': gesture['button'], 'gesture': gesture['gesture'], 'source': gesture['source'],
                          'handlers': [handler, possible], 'overlaps': [{'target': target, 'handlers': [handler['id'], possible['id']],
                                                                       'kind': 'opposing', 'conditional': True}]}]}
        self.inv['coverage'] = self.ai_preview['analysis']['coverage']
        self.ai_results = [(502, {'ok': False, 'error': 'AI is disabled.'})]
        self.open_control()
        row = self.row(button='Left')
        expect(row.get_by_role('link', name='Bedtime lights')).to_have_attribute('href', '/config/automation/edit/fixture_lights')
        expect(row).to_contain_text('Trigger match')
        expect(row).to_contain_text('After sunset')
        expect(row).to_contain_text('Living room lights')
        expect(row).to_contain_text('Guest mode is off')
        expect(row).to_contain_text('via script.bedtime')
        expect(row).to_contain_text('Possible match')
        expect(row).to_contain_text('Possible opposing actions on Living room lights')
        expect(self.page.get_by_text(re.compile('2 of 3 automation configs readable'))).to_be_visible()
        expect(self.row()).to_contain_text('No readable handler matched')
        self.assertEqual(self.ai_calls, [])
        self.page.get_by_text('Analyze with AI', exact=True).click()
        self.page.get_by_role('button', name='Send this review to Medium AI').click()
        expect(self.page.get_by_role('alert').filter(has_text='AI is disabled.')).to_be_visible()
        expect(row).to_contain_text('After sunset')
        self.assertEqual(len(self.ai_calls), 1)
        self.assertEqual(self.queue_calls + self.posts + self.puts, [])

    def test_buttons_stale_ai_preview_requires_fresh_consent(self):
        self.ai_results = [(409, {'ok': False, 'code': 'stale', 'error': 'The mapping evidence changed.'})]
        self.open_control()
        self.page.get_by_text('Analyze with AI', exact=True).click()
        send = self.page.get_by_role('button', name='Send this review to Medium AI')
        send.click()
        expect(self.page.get_by_role('alert').filter(has_text='The mapping evidence changed.')).to_be_visible()
        expect(send).to_have_count(0)
        self.ai_preview = {'content': '{"control":"Refreshed fixture"}', 'fingerprint': 'c' * 64, 'count': 1}
        self.page.get_by_role('button', name='Refresh preview').click()
        expect(self.page.get_by_label('AI request evidence')).to_have_text(self.ai_preview['content'])
        self.assertEqual(self.ai_calls, [{'fingerprint': 'b' * 64}])
        send.click()
        expect(self.page.get_by_role('region', name='AI analysis')).to_be_visible()
        self.assertEqual(self.ai_calls, [{'fingerprint': 'b' * 64}, {'fingerprint': 'c' * 64}])

    def test_buttons_late_ai_answer_cannot_cross_selected_controls(self):
        pending = []
        self.page.route('**/api/buttons/*/ai-review', lambda route: pending.append(route))
        self.open_control()
        self.page.get_by_text('Analyze with AI', exact=True).click()
        with self.page.expect_request('**/api/buttons/*/ai-review'):
            self.page.get_by_role('button', name='Send this review to Medium AI').click()
        self.page.get_by_role('button', name=re.compile('^Six-button remote')).click()
        expect(self.page.get_by_role('heading', name='Six-button remote', exact=True)).to_be_visible()
        pending.pop().fulfill(json={'ok': True, 'model': 'fixture', 'text': 'Answer for the previous control'})
        self.page.get_by_text('Analyze with AI', exact=True).click()
        expect(self.page.get_by_text('Answer for the previous control')).to_have_count(0)
        expect(self.page.get_by_role('button', name='Send this review to Medium AI')).to_be_enabled()

    def test_buttons_changes_review_explains_the_grouped_map(self):
        self.open_control()
        self.save(self.editor(self.row()))
        self.page.get_by_role('button', name='Review changes', exact=True).click()
        self.page.get_by_role('heading', name='Changes', exact=True).wait_for()
        self.assertIn('button automation', self.page.get_by_role('main').inner_text())
        self.assertIn('Short press', self.page.get_by_role('main').inner_text())
        self.assertIn('light.toggle', self.page.get_by_role('main').inner_text())
        self.assertNotIn('recipe for undefined', self.page.get_by_role('main').inner_text())

    def test_buttons_reference_notes_for_a_control_with_no_detected_gestures(self):
        jev_calls = []
        self.page.route("**/api/jev/checks/*", lambda route: (
            jev_calls.append(route.request.post_data_json), route.fulfill(json={"ok": False, "error": "Unexpected Jev call"}),
        ))
        self.add_entity("button.kitchen_strip_identify", "button", "identify", name="Kitchen Strip Identify")
        self.add_entity("button.kitchen_strip_blink", "button", name="Kitchen Strip Blink")
        self.add_entity("button.desk_press", "button", name="Desk press")
        self.inv["identifyButtons"] = ["button.kitchen_strip_blink"]
        if "button.press" not in self.inv["services"]:
            self.inv["services"].append("button.press")
        self.open_control("unknown")
        notes = self.page.get_by_role("region", name="Button reference notes", exact=True)
        expect(notes).to_contain_text("Saved in Taxis for reference")
        expect(self.page.get_by_text("HA did not expose button gestures", exact=False)).to_be_visible()
        notes.get_by_role("button", name="Add button note", exact=True).click()
        form = notes.get_by_role("form", name="New button note", exact=True)
        expect(form.locator("datalist option")).to_have_count(5)
        expect(form.get_by_label("Function type")).to_have_value("service")
        form.get_by_label("Button name or number").fill("Button 2")
        form.get_by_label("Press type").fill("Triple tap")
        form.get_by_label("Function type").select_option("custom")
        form.get_by_label("Function description").fill("Closes the blinds over the keypad’s hub.")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.get_by_role("complementary", name="Button controls").get_by_role("button", name=re.compile("^Bedroom wall control")).click()
        expect(form.get_by_label("Function description")).to_have_value("Closes the blinds over the keypad’s hub.")
        form.get_by_role("button", name="Save button note", exact=True).click()
        expect(notes.get_by_role("list", name="Saved button notes")).to_contain_text("Button 2 · Triple tap")
        self.page.reload(wait_until="networkidle")
        expect(notes.get_by_text("Closes the blinds over the keypad’s hub.", exact=True)).to_be_visible()
        notes.get_by_role("button", name="Edit Button 2 note", exact=True).click()
        form = notes.get_by_role("form", name="Edit button note", exact=True)
        form.get_by_label("Function type").select_option("service")
        form.get_by_label("Press type").fill("Long press")
        form.get_by_label("Home Assistant service", exact=True).select_option("button.press")
        target = form.get_by_label("Entity target (optional)", exact=True)
        expect(target.locator("option[value='button.desk_press']")).to_have_count(1)
        expect(target.locator("option[value^='button.kitchen_strip']")).to_have_count(0)
        form.get_by_label("Home Assistant service", exact=True).select_option("light.toggle")
        target.select_option("light.living_all")
        form.get_by_role("button", name="Save button note", exact=True).click()
        expect(notes.get_by_role("list", name="Saved button notes")).to_contain_text("light.toggle")
        notes.get_by_role("button", name="Remove Button 2 note", exact=True).click()
        notes.get_by_role("group", name="Confirm", exact=True).get_by_role("button", name="Remove", exact=True).click()
        expect(notes.get_by_role("list", name="Saved button notes")).to_have_count(0)
        self.assertEqual([call[0] for call in self.reference_calls], ["POST", "PUT", "DELETE"])
        self.assertEqual(self.reference_calls[0][3], {
            "button": "Button 2", "press": "Triple tap", "action": {"kind": "custom", "description": "Closes the blinds over the keypad’s hub."},
        })
        self.assertEqual(self.reference_calls[1][3]["action"]["target"]["id"], "light.living_all")
        self.assertEqual(self.reference_calls[1][3]["revision"], 1)
        self.assertEqual(self.reference_calls[2][3], {"revision": 2})
        self.assertEqual(jev_calls + self.queue_calls + self.ai_calls + self.posts + self.applies, [])

    def test_buttons_reference_late_load_and_save_stay_with_the_original_control(self):
        held = []
        next_method = ["GET"]
        def delay(route):
            path = unquote(urlsplit(route.request.url).path)
            if path.endswith("/device:unknown/references") and next_method and route.request.method == next_method[0]:
                next_method.pop()
                held.append(route)
            else:
                route.fallback()
        self.page.route("**/api/buttons/*/references", delay)
        self.page.goto(fixture.BASE + "/#automations/buttons/device%3Aunknown", wait_until="domcontentloaded")
        controls = self.page.get_by_role("complementary", name="Button controls")
        expect(self.page.get_by_role("region", name="Button reference notes", exact=True)).to_be_visible()
        expect(self.page.get_by_role("heading", name="Unexposed keypad", exact=True)).to_be_visible()
        expect(self.page.get_by_text("Reading button notes…", exact=True)).to_be_visible()
        controls.get_by_role("button", name=re.compile("^Bedroom wall control")).click()
        expect(self.page.get_by_role("heading", name="Bedroom wall control", exact=True)).to_be_visible()
        late = {"id": "24d5e061-6d13-4353-bfc6-8d909bf5864f", "revision": 1, "button": "Previous control", "press": "Single press",
                "action": {"kind": "custom", "description": "Previous control description"}}
        held.pop().fulfill(json={"ok": True, "references": [late]})
        expect(self.page.get_by_text("Previous control description", exact=True)).to_have_count(0)
        controls.get_by_role("button", name=re.compile("^Unexposed keypad")).click()
        expect(self.page.get_by_role("heading", name="Unexposed keypad", exact=True)).to_be_visible()
        notes = self.page.get_by_role("region", name="Button reference notes", exact=True)
        notes.get_by_role("button", name="Add button note", exact=True).click()
        form = notes.get_by_role("form", name="New button note", exact=True)
        form.get_by_label("Button name or number").fill("Original keypad")
        form.get_by_label("Press type").fill("Single press")
        form.get_by_label("Function type").select_option("custom")
        form.get_by_label("Function description").fill("Do not show in the new control")
        next_method.append("POST")
        with self.page.expect_request(lambda request: request.url.endswith("/references") and request.method == "POST"):
            form.get_by_role("button", name="Save button note", exact=True).click()
        self.page.once("dialog", lambda dialog: dialog.accept())
        controls.get_by_role("button", name=re.compile("^Bedroom wall control")).click()
        expect(self.page.get_by_role("heading", name="Bedroom wall control", exact=True)).to_be_visible()
        held.pop().fulfill(json={"ok": True, "references": [late]})
        expect(self.page.get_by_text("Previous control description", exact=True)).to_have_count(0)
        expect(self.page.get_by_text("Button note saved in Taxis.", exact=True)).to_have_count(0)

    def test_buttons_native_mapping_target_picker_excludes_identify_entities(self):
        self.add_entity("button.kitchen_strip_identify", "button", "identify", name="Kitchen Strip Identify")
        self.add_entity("button.kitchen_strip_blink", "button", name="Kitchen Strip Blink")
        self.add_entity("button.desk_press", "button", name="Desk press")
        self.inv["identifyButtons"] = ["button.kitchen_strip_blink"]
        if "button.press" not in self.inv["services"]:
            self.inv["services"].append("button.press")
        self.open_control()
        form = self.editor(self.row())
        target = form.get_by_label("Button action target", exact=True)
        expect(target.locator("option[value='light.living_all']")).to_have_count(1)
        expect(target.locator("option[value='button.desk_press']")).to_have_count(1)
        expect(target.locator("option[value^='button.kitchen_strip']")).to_have_count(0)
        self.assertEqual(self.queue_calls + self.posts + self.applies, [])

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
