"""Every shipped plugin contract.json validates under core's manifest rules (ADR 0038, contract v1)."""
import importlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import types
import unittest

PLUGINS = Path(__file__).resolve().parents[2] / 'managed/plugins'
PACKAGE = PLUGINS.parent / 'core/identity'
if 'pythia_identity_fixture' not in sys.modules:
    spec = importlib.util.spec_from_file_location(
        'pythia_identity_fixture', PACKAGE / '__init__.py', submodule_search_locations=[str(PACKAGE)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
identity = sys.modules['pythia_identity_fixture']


def manifest(plugin):
    return identity.validate_manifest(json.loads((PLUGINS / plugin / identity.MANIFEST_FILE).read_text()))


def checked_batch(plugin, result):
    """A resolve tool result as core receives it: parsed, then checked against the plugin's contract."""
    body = json.loads(result) if isinstance(result, str) else result
    assert body['schema_version'] == 1, body
    batch = identity.batch_from_json(body['data'])
    identity.check_batch(batch, manifest(plugin))
    return batch


def definition(plugin):
    """The plugin's own operation -> native tool table, loaded without running its registration."""
    name = 'contract_fixture_' + plugin.replace('-', '_')
    if name not in sys.modules:
        package = types.ModuleType(name)
        package.__path__ = [str(PLUGINS / plugin)]
        sys.modules[name] = package
    return importlib.import_module(name + '.definition')


class ShippedContracts(unittest.TestCase):
    def test_every_contract_validates_and_names_its_own_operations(self):
        shipped = sorted(path.parent.name for path in PLUGINS.glob('*/' + identity.MANIFEST_FILE))
        self.assertEqual(shipped, ['coingecko', 'coinmarketcap', 'eodhd', 'gleif', 'sec', 'xbrl-filings',
                                   'yahoo-discovery'])
        for plugin in shipped:
            with self.subTest(plugin=plugin):
                contract = manifest(plugin)
                self.assertEqual(contract.contract_version, identity.CONTRACT_VERSION)
                declaration = (PLUGINS / plugin / 'plugin.yaml').read_text()
                self.assertEqual(contract.plugin, re.search(r'^name: (\S+)$', declaration, re.M)[1])
                # Contracts name plugin operations, never tools; each is one the plugin's own tools implement.
                tools = set(re.findall(r'^  - (pythia_\w+)$', declaration, re.M))
                own = definition(plugin).TOOLS
                self.assertLessEqual(contract.plugin_operations, set(own))
                self.assertLessEqual({own[name] for name in contract.plugin_operations}, tools)

    def test_attribution_the_provider_requires_is_declared(self):
        self.assertEqual(manifest('coingecko').rights.attribution.text, 'Powered by CoinGecko')
        self.assertEqual(manifest('coinmarketcap').rights.attribution.text, 'Data provided by CoinMarketCap.com')
        # One-investor terms stay personal; open reference sources are open. No provider data is hostable yet.
        self.assertEqual({plugin: manifest(plugin).rights.licence for plugin in ('eodhd', 'yahoo-discovery', 'sec')},
                         {'eodhd': 'personal', 'yahoo-discovery': 'personal', 'sec': 'open'})
        self.assertFalse(any(manifest(path.parent.name).rights.hostable
                             for path in PLUGINS.glob('*/' + identity.MANIFEST_FILE)))

    def test_filing_sources_declare_their_authorities(self):
        self.assertEqual(manifest('sec').concepts[identity.Concept.FILINGS].authorities, ('sec',))
        self.assertEqual(manifest('xbrl-filings').concepts[identity.Concept.FILINGS].authorities, ('esma', 'fca'))

if __name__ == '__main__':
    unittest.main()
