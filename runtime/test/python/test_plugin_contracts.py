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


def adapter_view():
    """What core's Hermes adapter maps for the shipped plugins, from their own schemas, as `installed()` sees it."""
    from market_data_fixture import wire
    from test_identity_queue import load_core
    load_core()
    from pythia_core_queue_fixture import identity_ops
    owners, schemas = {}, {}
    for path in PLUGINS.glob('*/' + identity.MANIFEST_FILE):
        key = re.search(r'^name: (\S+)$', (path.parent / 'plugin.yaml').read_text(), re.M)[1]
        for schema in definition(path.parent.name).schemas(wire).values():
            owners[schema['name']], schemas[schema['name']] = key, schema
    return identity_ops, identity_ops.operation_tools(owners, schemas)


class ShippedContracts(unittest.TestCase):
    def test_every_contract_validates_and_its_operations_reach_the_tools_that_declare_them(self):
        shipped = sorted(path.parent.name for path in PLUGINS.glob('*/' + identity.MANIFEST_FILE))
        self.assertEqual(shipped, ['coingecko', 'coinmarketcap', 'eodhd', 'gleif', 'hyperliquid', 'sec',
                                   'xbrl-filings', 'yahoo-discovery'])
        _ops, mapped = adapter_view()
        for plugin in shipped:
            with self.subTest(plugin=plugin):
                contract = manifest(plugin)
                self.assertEqual(contract.contract_version, identity.CONTRACT_VERSION)
                declaration = (PLUGINS / plugin / 'plugin.yaml').read_text()
                self.assertEqual(contract.plugin, re.search(r'^name: (\S+)$', declaration, re.M)[1])
                tools = set(re.findall(r'^  - (pythia_\w+)$', declaration, re.M))
                # Concept and resolve operations are what core dispatches: the adapter must map each to a tool.
                dispatched = {name for entry in contract.concepts.values() for name in entry.operations.values()}
                dispatched |= {contract.resolve.operation} if contract.resolve else set()
                found = mapped.get(contract.plugin, {})
                self.assertLessEqual(dispatched, set(found))
                self.assertLessEqual({found[name] for name in dispatched}, tools)
                # A catalogue is run by the plugin's own sync, not by core: it names the plugin's own operation.
                if contract.catalogue_operation:
                    self.assertIn(contract.catalogue_operation, definition(plugin).TOOLS)

    def test_an_operation_two_tools_declare_is_not_mapped(self):
        ops, _mapped = adapter_view()

        def marked(**marks):
            return {'parameters': {'$comment': json.dumps(marks)}}
        contribution = {'operations': [{'operation': 'profile', 'tool': 'b_profile'}]}
        schemas = {'a_profile': marked(pythia_http_operation={'plugin': 'a', 'operation': 'profile'}),
                   'b_profile': marked(pythia_market_data=contribution),
                   'a_resolve': marked(pythia_http_operation={'plugin': 'a', 'operation': 'resolve'}),
                   'foreign': marked(pythia_http_operation={'plugin': 'a', 'operation': 'filings'})}
        owners = {'a_profile': 'a', 'b_profile': 'a', 'a_resolve': 'a', 'foreign': 'other'}
        with self.assertLogs("pythia_core_queue_fixture.native_ops", "WARNING"):
            self.assertEqual(ops.operation_tools(owners, schemas), {'a': {'resolve': 'a_resolve'},
                                                                    'other': {'filings': 'foreign'}})

    def test_provider_terms_are_declared(self):
        self.assertEqual((manifest('coingecko').rights.attribution.text, manifest('coingecko').rights.attribution.url),
                         ('Powered by CoinGecko API', 'https://www.coingecko.com/en/api/'))
        self.assertEqual(manifest('coinmarketcap').rights.attribution.text, 'Data provided by CoinMarketCap.com')
        # The free Demo plan is personal use; CoinMarketCap's Basic plan allows commercial use.
        self.assertEqual({plugin: manifest(plugin).rights.licence
                          for plugin in ('coingecko', 'coinmarketcap', 'eodhd', 'yahoo-discovery', 'sec')},
                         {'coingecko': 'personal', 'coinmarketcap': 'business', 'eodhd': 'personal',
                          'yahoo-discovery': 'personal', 'sec': 'open'})
        self.assertFalse(any(manifest(path.parent.name).rights.hostable
                             for path in PLUGINS.glob('*/' + identity.MANIFEST_FILE)))

    def test_every_shipped_source_declares_its_signoff(self):
        # ADR 0042: the sources in use before the standard keep their role until their turn, each pointing at the
        # record it will be onboarded in; anything newer ships unsigned; a signed-off source links a record that exists.
        root = PLUGINS.parents[2]
        standing = {}
        for path in PLUGINS.glob('*/' + identity.MANIFEST_FILE):
            contract = manifest(path.parent.name)
            standing[contract.plugin] = contract.signoff
            with self.subTest(plugin=contract.plugin):
                if contract.signoff is identity.SignOff.SIGNED_OFF:
                    self.assertTrue((root / contract.record).is_file())
                elif contract.signoff is identity.SignOff.GRANDFATHERED:
                    self.assertEqual(contract.record, f'docs/sources/{contract.provider}.md')
        self.assertEqual({plugin for plugin, status in standing.items() if status is identity.SignOff.GRANDFATHERED},
                         {'pythia-coingecko', 'pythia-coinmarketcap', 'pythia-eodhd', 'pythia-gleif', 'pythia-sec',
                          'pythia-xbrl-filings', 'pythia-yahoo-discovery'})
        self.assertEqual(standing['pythia-hyperliquid'], identity.SignOff.UNSIGNED)  # opt-in and display-only
        self.assertEqual(set(standing), identity.BUNDLED)  # core knows every plugin Pythia ships

    def test_a_plugin_pythia_does_not_bundle_cannot_vouch_for_itself(self):
        sec = manifest('sec')
        self.assertIs(identity.vouched(sec, 'pythia-sec').signoff, identity.SignOff.GRANDFATHERED)
        self.assertTrue(identity.vouched(sec, 'community-sec').unaudited)

    def test_filing_sources_declare_their_authorities(self):
        self.assertEqual(manifest('sec').concepts[identity.Concept.FILINGS].authorities, ('sec',))
        self.assertEqual(manifest('xbrl-filings').concepts[identity.Concept.FILINGS].authorities, ('esma', 'fca'))

if __name__ == '__main__':
    unittest.main()
