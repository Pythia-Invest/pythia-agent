"""Synthetic modules exercise explicit native presentation ownership and bounds."""
import hashlib
import importlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_market_data_identity import PACKAGE, PLATFORM, platform_module

widgets = importlib.import_module(PLATFORM + '.widgets')
operations = importlib.import_module(PLATFORM + '.operations')
presentation = importlib.import_module(PACKAGE + '.presentation')


class WidgetPresentations(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(directory).resolve()
        (self.root / 'widgets').mkdir()
        self.file = self.root / 'widgets/view.mjs'
        self.content = 'export const css="";export const label="synthetic café";'
        self.file.write_text(self.content, encoding='utf-8')
        self.registered = []
        self.ctx = SimpleNamespace(plugin_id='research/synthetic', manifest=SimpleNamespace(path=str(self.root)),
                                   register_tool=lambda **tool: self.registered.append(tool))
        self.definitions = [{'id': 'view', 'asset': 'view', 'input_contract': 'synthetic.view.v1'}]
        self.assets = {'view': 'widgets/view.mjs'}

    def register(self, **overrides):
        widgets.register_widget_presentation(self.ctx, tool_name='synthetic_widgets', toolset='synthetic',
            **({'widgets': self.definitions, 'assets': self.assets} | overrides))
        return self.registered[-1]

    def test_native_declaration_and_exact_utf8_hash_share_one_explicit_map(self):
        tool = self.register()
        declaration = operations.declaration(tool['schema'])
        self.assertEqual(declaration['plugin'], self.ctx.plugin_id)
        self.assertEqual(declaration['operation'], 'widgets')
        self.assertTrue(declaration['read_only'])
        self.assertFalse(declaration['updates'])
        self.assertEqual(declaration['cache_seconds'], 0)
        self.assets['view'] = 'not-allowed.mjs'
        self.definitions[0]['id'] = 'mutated'
        metadata = json.loads(tool['handler']({}))['data']
        content = json.loads(tool['handler']({'asset': 'view'}))['data']
        self.assertEqual(metadata['widgets'][0]['id'], 'view')
        self.assertEqual(metadata['assets'], [{'id': 'view', 'media_type': 'text/javascript',
            'bytes': len(self.content.encode('utf-8')),
            'sha256': hashlib.sha256(self.content.encode('utf-8')).hexdigest()}])
        self.assertEqual(content['content'], self.content)
        self.assertEqual(content['sha256'], metadata['assets'][0]['sha256'])
        self.assertEqual(content['bytes'], metadata['assets'][0]['bytes'])
        self.assertGreater(content['bytes'], len(content['content']))  # Multibyte UTF-8, not character count.
        self.assertEqual(content['asset'], 'view')
        # Ordinary reads do not cache source content or skip the platform's
        # permission checks on later requests.
        self.file.write_text('export const changed = true;', encoding='utf-8')
        self.assertNotEqual(json.loads(tool['handler']({}))['data']['assets'][0]['sha256'], content['sha256'])

    def test_callers_cannot_select_paths_or_claim_another_plugin(self):
        tool = self.register()
        for arguments in ({'asset': '../view'}, {'asset': '/view'}, {'asset': 'missing'},
                          {'asset': []}, {'path': 'widgets/view.mjs'}, {'plugin': 'other'}):
            with self.subTest(arguments=arguments):
                self.assertIn('error', json.loads(tool['handler'](arguments)))
        with self.assertRaises(TypeError): self.register(plugin='other')
        for path in ('../view.mjs', '/view.mjs', 'widgets/./view.mjs', 'widgets//view.mjs', 'secret.json'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.register(assets={'view': path})
        for definitions in ([*self.definitions, *self.definitions],
                            [{'id': 'view', 'asset': 'missing', 'input_contract': 'view.v1'}],
                            [{'id': 'view', 'asset': 'view', 'input_contract': 'view v1'}]):
            with self.subTest(definitions=definitions), self.assertRaises(ValueError):
                self.register(widgets=definitions)

    def test_missing_linked_empty_oversized_or_non_utf8_modules_are_errors_not_assets(self):
        handle = self.register()['handler']
        self.file.unlink()
        self.assertIn('error', json.loads(handle({})))
        outside = self.root / 'unlisted.mjs'
        outside.write_text('unlisted', encoding='utf-8')
        self.file.symlink_to(outside)
        self.assertIn('error', json.loads(handle({'asset': 'view'})))
        self.file.unlink()
        self.file.write_bytes(b'')
        self.assertIn('error', json.loads(handle({})))
        self.assertIn('error', json.loads(handle({'asset': 'view'})))
        self.file.write_bytes(b'\xff')
        self.assertIn('error', json.loads(handle({'asset': 'view'})))
        self.file.write_bytes(b'a' * (widgets.MAX_ASSET_BYTES + 1))
        self.assertIn('error', json.loads(handle({})))

    def test_missing_widget_helper_warns_without_removing_financial_registration(self):
        with patch.object(presentation, 'platform', return_value=SimpleNamespace(API_VERSION=1)):
            with self.assertLogs(presentation.__name__, level='WARNING') as messages:
                presentation.register(self.ctx)
        self.assertEqual(self.registered, [])
        self.assertIn('financial backend remains available', messages.output[0])
        with patch.object(presentation, 'platform', return_value=platform_module):
            presentation.register(self.ctx)
        self.assertEqual(self.registered[0]['name'], 'pythia_market_data_widgets')
        self.assertEqual(self.registered[0]['schema']['parameters']['properties']['asset']['enum'],
                         list(presentation.ASSETS))


if __name__ == '__main__':
    unittest.main()
