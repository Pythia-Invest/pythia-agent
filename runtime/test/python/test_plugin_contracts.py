"""Every shipped plugin contract.json validates under core's manifest rules (ADR 0038)."""
import importlib.util
import json
from pathlib import Path
import re
import sys
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


class ShippedContracts(unittest.TestCase):
    def test_every_contract_validates_and_names_its_own_native_tools(self):
        shipped = sorted(path.parent.name for path in PLUGINS.glob('*/' + identity.MANIFEST_FILE))
        self.assertEqual(shipped, ['coingecko', 'coinmarketcap', 'eodhd', 'gleif', 'sec', 'xbrl-filings',
                                   'yahoo-discovery'])
        for plugin in shipped:
            with self.subTest(plugin=plugin):
                contract = manifest(plugin)
                declaration = (PLUGINS / plugin / 'plugin.yaml').read_text()
                self.assertEqual(contract.plugin, re.search(r'^name: (\S+)$', declaration, re.M)[1])
                tools = set(re.findall(r'^  - (pythia_\w+)$', declaration, re.M))
                named = {entry.tool for entry in contract.content.values()}
                named |= {contract.resolve.tool} if contract.resolve else set()
                named |= {contract.catalogue_tool} if contract.catalogue_tool else set()
                self.assertLessEqual(named, tools)


if __name__ == '__main__':
    unittest.main()
