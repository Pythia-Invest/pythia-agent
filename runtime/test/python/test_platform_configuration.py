"""Plugin configuration: static declarations read against file-based device custody."""
import importlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from market_data_fixture import PACKAGE, PLATFORM, platform_module  # noqa: F401 - loads the core fixture

configuration = importlib.import_module(PLATFORM + '.configuration')
access = importlib.import_module(PLATFORM + '.access')
credentials = importlib.import_module(PACKAGE + '.credentials')

CONTACT = {'key': 'sec_identity', 'kind': 'identity', 'label': 'SEC contact',
           'description': 'Name email@example.org', 'url': 'https://www.sec.gov/os/accessing-edgar-data',
           'required': True}
TOKEN = {'key': 'example_api_token', 'kind': 'secret', 'label': 'Example API token'}


class PluginConfiguration(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.config = self.root / 'config'
        self.config.mkdir(mode=0o700)
        self.enterContext(patch.dict(os.environ, {'PYTHIA_CONFIG_ROOT': str(self.config)}))
        package = self.root / 'plugin'
        package.mkdir()
        (package / 'configuration.json').write_text(json.dumps({'schema_version': 1, 'fields': [TOKEN, CONTACT]}))
        self.ctx = SimpleNamespace(manifest=SimpleNamespace(path=str(package)))

    def store(self, name, values, mode=0o600):
        path = self.config / name
        path.write_text(json.dumps({'schema_version': 1, **values}))
        path.chmod(mode)
        return path

    def test_declarations_reject_reserved_duplicate_and_unsafe_entries(self):
        for fields in ([{**TOKEN, 'key': 'schema_version'}], [{**TOKEN, 'key': 'hermes_api_key'}],
                       [{**TOKEN, 'key': 'hermes_settings_token'}], [{**TOKEN, 'key': 'pythia_anything'}], [TOKEN, TOKEN],
                       [{**TOKEN, 'url': 'http://example.org'}], [{**TOKEN, 'url': 'https://user@example.org'}],
                       [{**TOKEN, 'kind': 'oauth'}], [{**TOKEN, 'label': 'Token\r\nX-Injected: 1'}],
                       [{**TOKEN, 'extra': True}], [{**TOKEN, 'required': 'yes'}], [{**TOKEN, 'key': 'Upper'}]):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                configuration.parse({'schema_version': 1, 'fields': fields})
        for declaration in ({'fields': [TOKEN]}, {'schema_version': 1, 'fields': [TOKEN], 'check': 'op'}):
            with self.subTest(declaration=declaration), self.assertRaises(ValueError):
                configuration.parse(declaration)

    def test_values_come_from_private_files_and_required_fields_gate_the_plugin(self):
        self.assertEqual(configuration.value(self.ctx, 'example_api_token'), ('missing', None))
        blocked = configuration.needs_configuration(self.ctx)
        self.assertEqual(blocked['issues'][0]['code'], 'needs_configuration')
        self.assertEqual(blocked['issues'][0]['fields'], [
            {'key': 'sec_identity', 'label': 'SEC contact', 'file': 'settings.json', 'status': 'missing'}])

        self.store('secrets.json', {'example_api_token': 'synthetic-token', 'hermes_api_key': 'not-offered'})
        settings = self.store('settings.json', {'sec_identity': 'Example Person person@example.org'})
        self.assertEqual(configuration.value(self.ctx, 'example_api_token'), ('configured', 'synthetic-token'))
        self.assertEqual(configuration.value(self.ctx, 'sec_identity'),
                         ('configured', 'Example Person person@example.org'))
        self.assertIsNone(configuration.needs_configuration(self.ctx))
        for reserved in ('hermes_api_key', 'hermes_settings_token'):
            with self.assertRaises(ValueError):
                configuration.read('secret', reserved)

        settings.chmod(0o644)  # A loosened file is refused and reported, never read.
        self.assertEqual(configuration.missing(self.ctx)[0]['status'], 'invalid')
        self.store('secrets.json', {'example_api_token': 'two words'})
        self.assertEqual(configuration.value(self.ctx, 'example_api_token'), ('invalid', None))

    def test_unsafe_stores_read_as_invalid(self):
        target = self.store('elsewhere.json', {'example_api_token': 'synthetic-token'})
        (self.config / 'secrets.json').symlink_to(target)
        self.assertEqual(configuration.value(self.ctx, 'example_api_token'), ('invalid', None))
        (self.config / 'secrets.json').unlink()
        self.store('secrets.json', {'example_api_token': 'x' * configuration.MAX_BYTES})
        self.assertEqual(configuration.value(self.ctx, 'example_api_token'), ('invalid', None))
        self.store('secrets.json', {'example_api_token': 'x' * 513})
        self.assertEqual(configuration.value(self.ctx, 'example_api_token'), ('invalid', None))

    def test_market_data_uses_the_core_reader(self):
        self.store('secrets.json', {'eodhd_api_token': 'synthetic-eodhd'})
        self.assertEqual(credentials.eodhd_token(), ('configured', 'synthetic-eodhd'))

    def test_cached_access_changes_when_identity_settings_change(self):
        self.store('secrets.json', {})
        without = access.canonical_access_revision()
        self.assertIsNotNone(without)
        settings = self.store('settings.json', {'sec_identity': 'Example Person person@example.org'})
        first = access.canonical_access_revision()
        self.assertNotEqual(first, without)
        os.utime(settings, ns=(1, 1))
        self.assertNotEqual(access.canonical_access_revision(), first)
        settings.chmod(0o644)
        self.assertIsNone(access.canonical_access_revision())


if __name__ == '__main__':
    unittest.main()
