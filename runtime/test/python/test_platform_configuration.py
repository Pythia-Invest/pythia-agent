"""Static plugin configuration: native enablement decides visibility, custody holds values."""
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from test_market_data_identity import PLATFORM, platform_module  # noqa: F401 - loads the core fixture

configuration = importlib.import_module(PLATFORM + '.configuration')

CONTACT = {'key': 'sec_identity', 'kind': 'identity', 'label': 'SEC contact',
           'help': 'Name email@example.org', 'required': True}
TOKEN = {'key': 'example_api_token', 'kind': 'secret', 'label': 'Example API token'}


class PluginConfiguration(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()

    def plugin(self, name, declaration, loaded=True):
        directory = self.root / 'plugins' / name
        directory.mkdir(parents=True)
        if declaration is not None:
            (directory / 'configuration.json').write_text(json.dumps(declaration), encoding='utf-8')
        return SimpleNamespace(enabled=True, module=object() if loaded else None, manifest=SimpleNamespace(
            name=name, description='Synthetic %s feature' % name, path=str(directory), source='user', kind='standalone'))

    def declared(self, plugins, enabled):
        manager = SimpleNamespace(_plugins=plugins)
        config = {'plugins': {'enabled': enabled}}
        modules = {'hermes_cli': ModuleType('hermes_cli'),
                   'hermes_cli.config': SimpleNamespace(load_config_readonly=lambda: config),
                   'hermes_cli.plugins': SimpleNamespace(get_plugin_manager=lambda: manager)}
        with patch.dict(sys.modules, modules), self.assertLogs(configuration.logger, 'WARNING') as logs:
            configuration.logger.warning('sentinel')
            rows = configuration.declared()
        return rows, logs.output[1:]

    def test_only_enabled_loaded_plugins_offer_valid_declarations(self):
        plugins = {
            'sec': self.plugin('sec', {'schema_version': 1, 'check': 'check_configuration', 'fields': [CONTACT]}),
            'prices': self.plugin('prices', {'schema_version': 1, 'fields': [TOKEN]}),
            'disabled': self.plugin('disabled', {'schema_version': 1, 'fields': [{**TOKEN, 'key': 'other_token'}]}),
            'unloaded': self.plugin('unloaded', {'schema_version': 1, 'fields': [TOKEN]}, loaded=False),
            'broken': self.plugin('broken', {'schema_version': 1, 'fields': [{**TOKEN, 'key': 'hermes_api_key'}]}),
            'plain': self.plugin('plain', None),
        }
        rows, warnings = self.declared(plugins, ['sec', 'prices', 'unloaded', 'broken', 'plain'])
        self.assertEqual(rows, [
            {'plugin': 'prices', 'name': 'prices', 'description': 'Synthetic prices feature',
             'fields': [{**TOKEN, 'help': '', 'required': False}]},
            {'plugin': 'sec', 'name': 'sec', 'description': 'Synthetic sec feature',
             'check': 'check_configuration', 'fields': [CONTACT]},
        ])
        self.assertEqual(len(warnings), 1)
        self.assertIn('broken', warnings[0])

    def test_shared_key_must_agree_on_kind(self):
        plugins = {'a': self.plugin('a', {'schema_version': 1, 'fields': [TOKEN]}),
                   'b': self.plugin('b', {'schema_version': 1, 'fields': [TOKEN, {**CONTACT, 'key': 'shared'}]}),
                   'c': self.plugin('c', {'schema_version': 1, 'fields': [{**TOKEN, 'key': 'shared'}]})}
        rows, warnings = self.declared(plugins, ['a', 'b', 'c'])
        self.assertEqual({row['plugin']: [field['key'] for field in row['fields']] for row in rows},
                         {'a': ['example_api_token'], 'b': ['example_api_token'], 'c': []})
        self.assertIn('shared', warnings[0])

    def test_declarations_reject_reserved_duplicate_and_unsafe_entries(self):
        for fields in ([{**TOKEN, 'key': 'schema_version'}], [TOKEN, TOKEN], [{**TOKEN, 'kind': 'oauth'}],
                       [{**TOKEN, 'label': 'Token\r\nX-Injected: 1'}], [{**TOKEN, 'extra': True}],
                       [{**TOKEN, 'required': 'yes'}], [{**TOKEN, 'key': 'Upper'}],
                       [dict(TOKEN, key='k%02d_token' % index) for index in range(17)]):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                configuration.parse({'schema_version': 1, 'fields': fields})
        for declaration in ({'fields': [TOKEN]}, {'schema_version': 1, 'check': '../other'},
                            {'schema_version': 1, 'connections': []}):
            with self.subTest(declaration=declaration), self.assertRaises(ValueError):
                configuration.parse(declaration)

    def test_owner_reads_declared_values_and_reports_missing_required_fields(self):
        ctx = SimpleNamespace(manifest=SimpleNamespace(path=self.plugin(
            'owner', {'schema_version': 1, 'fields': [TOKEN, CONTACT]}).manifest.path))
        config = self.root / 'config'
        config.mkdir(mode=0o700)
        self.enterContext(patch.dict(os.environ, {'PYTHIA_CONFIG_ROOT': str(config)}))
        self.assertEqual(configuration.value(ctx, 'example_api_token'), ('missing', None))
        self.assertEqual(configuration.missing(ctx), ['sec_identity'])
        secrets, settings = config / 'secrets.json', config / 'settings.json'
        secrets.write_text(json.dumps({'schema_version': 1, 'example_api_token': 'synthetic-token',
                                       'hermes_api_key': 'not-offered'}))
        settings.write_text(json.dumps({'schema_version': 1, 'sec_identity': 'Example Person person@example.org'}))
        secrets.chmod(0o600)
        settings.chmod(0o600)
        self.assertEqual(configuration.value(ctx, 'example_api_token'), ('configured', 'synthetic-token'))
        self.assertEqual(configuration.value(ctx, 'sec_identity'),
                         ('configured', 'Example Person person@example.org'))
        self.assertEqual(configuration.missing(ctx), [])
        with self.assertRaises(ValueError):
            configuration.value(ctx, 'hermes_api_key')
        settings.chmod(0o644)
        self.assertEqual(configuration.missing(ctx), ['sec_identity'])
        secrets.write_text(json.dumps({'schema_version': 1, 'example_api_token': 'two words'}))
        self.assertEqual(configuration.value(ctx, 'example_api_token'), ('invalid', None))


if __name__ == '__main__':
    unittest.main()
