"""Synthetic Vega-Lite artifacts exercise file boundaries and explicit revisions."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

# Ordinary deterministic CI intentionally has only the standard library. The
# copied-native qualification runs this suite with Hermes's pinned dependency.
if importlib.util.find_spec('jsonschema') is None:
    raise unittest.SkipTest('Requires Hermes jsonschema; run tooling/qualification/research-visuals.mjs with the prepared pinned Hermes source.')

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/research-visuals'
SPEC = importlib.util.spec_from_file_location('research_visual_test_plugin', ROOT / '__init__.py',
                                            submodule_search_locations=[str(ROOT)])
PLUGIN = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PLUGIN
SPEC.loader.exec_module(PLUGIN)
ARTIFACTS = sys.modules[SPEC.name + '.artifacts']
SNAPSHOTS = __import__(SPEC.name + '.snapshots', fromlist=['export'])


def artifact():
    return {'format': 'pythia-visual', 'version': 1, 'title': 'Synthetic revenue',
            'summary': 'Illustrative annual revenue in EUR millions.',
            'presentation': {'plugin': 'pythia-research-visuals', 'widget': 'research-visual',
                             'input_contract': 'pythia.research-visual.v1'},
            'data': {'kind': 'vega-lite', 'asOf': '2026-09-19', 'sources': [],
                     'assumptions': ['Synthetic example, not reported company data.'],
                     'spec': {'data': {'values': [{'year': 2025, 'revenue': 100}, {'year': 2026, 'revenue': 110}]},
                              'params': [{'name': 'growth', 'value': .05, 'bind': {'input': 'range', 'min': 0, 'max': 1}}],
                              'mark': 'line', 'encoding': {
                                  'x': {'field': 'year', 'type': 'ordinal'},
                                  'y': {'field': 'revenue', 'type': 'quantitative'}}}}}


class ResearchVisualTest(unittest.TestCase):
    def test_create_default_reopen_and_preserve_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as workspace:
            created = ARTIFACTS.create(artifact(), None, workspace)['data']
            self.assertTrue(created['path'].startswith('working/visuals/'))
            reopened = ARTIFACTS.read(created['path'], workspace)['data']
            self.assertEqual(reopened['artifact'], artifact())
            self.assertEqual(reopened['revision'], created['revision'])
            with self.assertRaises(FileExistsError):
                ARTIFACTS.create(artifact(), created['path'], workspace)
            self.assertEqual(json.loads(Path(workspace, created['path']).read_text()), artifact())

    def test_update_detects_stale_revisions_and_saves_parameters(self):
        with tempfile.TemporaryDirectory() as workspace:
            created = ARTIFACTS.create(artifact(), 'case/model.pythia-visual.json', workspace)['data']
            changed = artifact(); changed['data']['parameters'] = {'growth': .1}
            updated = ARTIFACTS.update(changed, created['path'], workspace, created['revision'])['data']
            self.assertNotEqual(created['revision'], updated['revision'])
            self.assertEqual(ARTIFACTS.read(created['path'], workspace)['data']['artifact'], changed)
            with self.assertRaisesRegex(ValueError, 'changed'):
                ARTIFACTS.update(artifact(), created['path'], workspace, created['revision'])
            with self.assertRaisesRegex(ValueError, 'revision'):
                ARTIFACTS.update(artifact(), created['path'], workspace, None)

    def test_paths_cannot_escape_or_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as workspace, tempfile.TemporaryDirectory() as outside:
            Path(workspace, 'link').symlink_to(outside, target_is_directory=True)
            for destination in ['../escape.pythia-visual.json', '/escape.pythia-visual.json',
                                'a/../escape.pythia-visual.json', 'a//escape.pythia-visual.json',
                                'link/escape.pythia-visual.json', '.private/escape.pythia-visual.json',
                                '.git/escape.pythia-visual.json', 'bad\nname.pythia-visual.json',
                                'bad\rname.pythia-visual.json', 'wrong.json']:
                with self.subTest(destination=destination), self.assertRaises((OSError, ValueError)):
                    ARTIFACTS.create(artifact(), destination, workspace)
            Path(workspace, 'existing.pythia-visual.json').symlink_to(Path(outside, 'escape.json'))
            with self.assertRaises(FileExistsError):
                ARTIFACTS.create(artifact(), 'existing.pythia-visual.json', workspace)
            with self.assertRaises(OSError):
                ARTIFACTS.read('existing.pythia-visual.json', workspace)
            with self.assertRaises(OSError):
                ARTIFACTS.update(artifact(), 'existing.pythia-visual.json', workspace, '0' * 64)
            self.assertEqual(list(Path(outside).iterdir()), [])

    def test_contract_rejects_external_data_nonfinite_and_oversize(self):
        cases = []
        for spec in [{'data': {'url': 'https://invalid.test'}}, {'mark': 'image'},
                     {'mark': {'type': 'image'}}, {'encoding': {'href': {'value': 'https://invalid.test'}}},
                     {'params': [{'name': 'x', 'bind': {'element': '#app'}}]},
                     {'__proto__': {}}, {'data': {'values': [float('nan')]}},
                     {'data': {'sequence': {'start': 0, 'stop': 1000000000}}},
                     {'data': {'sequence': {'stop': 10, 'step': 0}}},
                     {'data': {'values': list(range(10001))}}]:
            value = artifact(); value['data']['spec'] = spec; cases.append(value)
        value = artifact(); value['data']['asOf'] = '2026-02-30'; cases.append(value)
        value = artifact(); value['summary'] = 'x' * (ARTIFACTS.MAX_BYTES + 1); cases.append(value)
        value = artifact(); value['data']['parameters'] = {'unknown': .2}; cases.append(value)
        value = artifact(); value['data']['sources'] = [{'label': 'Unsafe', 'url': 'javascript:alert(1)'}]; cases.append(value)
        for value in cases:
            with self.subTest(value=str(value)[:100]), self.assertRaises(ValueError):
                ARTIFACTS.validate(value)

    def test_saved_parameters_follow_native_editable_variable_semantics(self):
        value = artifact()
        value['data']['spec']['params'] = [{'name': '$growth', 'bind': {'input': 'number'}}]
        value['data']['parameters'] = {'$growth': .15}
        ARTIFACTS.validate(value)
        for parameter in [{'name': '$growth', 'expr': '1 + 2'},
                          {'name': '$growth', 'select': 'point'},
                          {'name': '$growth', 'value': []}]:
            invalid = copy.deepcopy(value); invalid['data']['spec']['params'] = [parameter]
            with self.subTest(parameter=parameter), self.assertRaises(ValueError):
                ARTIFACTS.validate(invalid)
        for malformed in [None, {}, 'growth']:
            invalid = artifact(); invalid['data']['spec']['params'] = malformed
            with self.assertRaises(ValueError): ARTIFACTS.validate(invalid)
        value = artifact(); value['data']['spec']['data']['values'][0]['revenue'] = 10 ** 400
        with self.assertRaisesRegex(ValueError, 'finite'): ARTIFACTS.validate(value)
        value = artifact(); value['data']['spec'] = {'data': {'values': []}}
        with self.assertRaisesRegex(ValueError, 'mark'): ARTIFACTS.validate(value)

    def test_binding_admission_blocks_arbitrary_html_attributes(self):
        dangerous = [
            {"input": "select"}, {"input": "radio"},
            {'input': 'image', 'src': 'https://invalid.test', 'onerror': 'alert(1)'},
            {'input': 'range', 'oninput': 'alert(1)'},
            {'input': 'text', 'src': 'https://invalid.test'},
            {'input': 'file'},
            {'input': 'range', 'step': 0},
            {'field': {'input': 'range', 'onclick': 'alert(1)'}},
        ]
        for binding in dangerous:
            value = artifact(); value['data']['spec']['params'][0]['bind'] = binding
            with self.subTest(binding=binding), self.assertRaisesRegex(ValueError, 'Bindings'):
                ARTIFACTS.validate(value)
        accepted = ['legend', 'scales', {'field': {'input': 'range', 'min': 0, 'max': 1, 'step': .1}},
                    {'input': 'select', 'options': [None, 1, 'a', True], 'labels': ['', '1', 'A', 'Yes']},
                    {'input': 'checkbox', 'name': 'Show estimates', 'debounce': 100}]
        for binding in accepted:
            value = artifact(); value['data']['spec']['layer'] = [{'mark': 'line', 'params': [{'name': 'selected', 'bind': binding}]}]
            with self.subTest(binding=binding):
                ARTIFACTS.validate(value)

    def test_accepts_native_layers_and_expressions_without_a_chart_catalogue(self):
        value = artifact()
        value['data']['spec'] = {'data': {'values': [{'profit': 10}]},
                                'transform': [{'calculate': 'datum.profit * 2', 'as': 'projection'}],
                                'layer': [{'mark': 'bar'}, {'mark': 'text'}]}
        self.assertEqual(json.loads(ARTIFACTS.validate(value)), value)

    def test_svg_export_preserves_file_and_passes_saved_parameters(self):
        with tempfile.TemporaryDirectory() as workspace:
            value = artifact(); value['data']['parameters'] = {'growth': .15}
            created = ARTIFACTS.create(value, None, workspace)['data']
            with patch.object(SNAPSHOTS, 'render_svg', return_value=b'<svg xmlns="http://www.w3.org/2000/svg"/>') as render:
                exported = SNAPSHOTS.export(created['path'], 'case/chart.svg', workspace)['data']
                render.assert_called_once_with(value)
                self.assertTrue(Path(workspace, exported['path']).is_file())
                with self.assertRaises(FileExistsError):
                    SNAPSHOTS.export(created['path'], 'case/chart.svg', workspace)
                with self.assertRaises(ValueError):
                    SNAPSHOTS.export(created['path'], '../chart.svg', workspace)
            with patch.dict(os.environ, {'PYTHIA_NODE': ''}):
                with self.assertRaisesRegex(ValueError, 'managed Node'):
                    SNAPSHOTS.render_svg(value)

    def test_native_registration_and_tool_smoke(self):
        registered, skills, presentations = {}, [], []
        ctx = SimpleNamespace(plugin_id='pythia-research-visuals',
                              register_tool=lambda **value: registered.update({value['name']: value}),
                              register_skill=lambda *args, **kwargs: skills.append(args))
        support = SimpleNamespace(API_VERSION=1, register_widget_presentation=lambda *args, **kw: presentations.append(kw))
        manager = SimpleNamespace(_plugins={'pythia': SimpleNamespace(manifest=SimpleNamespace(name='pythia'),
                                  enabled=True, module=SimpleNamespace(platform=support))})
        native = SimpleNamespace(get_plugin_manager=lambda: manager)
        with patch.dict(sys.modules, {'hermes_cli.plugins': native}):
            PLUGIN.register(ctx)
        self.assertTrue(Path(skills[0][1]).is_file())
        self.assertEqual(presentations[0]['widgets'][0]['input_contract'], 'pythia.research-visual.v1')
        tool = registered['pythia_research_visual']
        self.assertNotIn('$comment', tool['schema']['parameters'])
        with tempfile.TemporaryDirectory() as workspace, patch.dict(os.environ, {'PYTHIA_WORKSPACE': workspace}), \
                patch.object(SNAPSHOTS, 'render_svg', return_value=b'<svg/>') as render:
            result = json.loads(tool['handler']({'artifact': artifact()}))['data']
            read = json.loads(tool['handler']({'action': 'read', 'destination': result['path']}))['data']
            self.assertEqual(read['artifact'], artifact())
            changed = copy.deepcopy(read['artifact']); changed['title'] = 'Changed'
            updated = json.loads(tool['handler']({'action': 'update', 'artifact': changed, 'destination': result['path'], 'revision': read['revision']}))
            self.assertIn('data', updated)
            self.assertEqual(render.call_count, 2)
            saved = Path(workspace, result['path']).read_bytes()
            render.side_effect = ValueError('Visual does not compile.')
            failed_create = json.loads(tool['handler']({'artifact': artifact(), 'destination': 'broken.pythia-visual.json'}))
            self.assertIn('error', failed_create)
            self.assertFalse(Path(workspace, 'broken.pythia-visual.json').exists())
            failed_update = json.loads(tool['handler']({'action': 'update', 'artifact': artifact(),
                'destination': result['path'], 'revision': updated['data']['revision']}))
            self.assertIn('error', failed_update)
            self.assertEqual(Path(workspace, result['path']).read_bytes(), saved)
            self.assertIn('error', json.loads(tool['handler']({'artifact': artifact(), 'destination': '../escape.pythia-visual.json'})))


if __name__ == '__main__':
    unittest.main()
