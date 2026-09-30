"""Scaffolding the Sui protocol plugins' tests share (Cetus, Suilend, DeepBook): load a plugin by directory, feed it a
canned answer per URL, read its pages as core's identity sync does, and pick claims apart. Not a test module."""
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sys

from market_data_fixture import connector, wire
from test_plugin_contracts import PLUGINS, checked_batch, identity

FIXTURES = Path(__file__).parent / 'fixtures'
STAMP = '2026-09-30T10:00:00+00:00'


def load(directory):
    """The plugin package and its catalogue module, loaded as core's registration would."""
    root = PLUGINS / directory
    spec = importlib.util.spec_from_file_location(f'{directory}_fixture', root / '__init__.py',
                                                  submodule_search_locations=[str(root)])
    plugin = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = plugin
    spec.loader.exec_module(plugin)
    return plugin, importlib.import_module(f'{spec.name}.catalogue')


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


class Transport:
    """A worker transport answering each URL from `answer(url)` and keeping the URLs asked."""

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def run_worker(self, _command, request, _environment, **_options):
        self.calls.append(request['url'])
        return {'data': deepcopy(self.answer(request['url'])), 'observed_at': STAMP, 'issues': []}


def reader(plugin, answer):
    transport = Transport(answer if callable(answer) else (lambda _url: answer))
    return plugin.Reader(wire, connector, transport=transport), transport


def pages(directory, read, scope):
    """Every page of a scope, each checked by core against the plugin's contract."""
    found, cursor = [], None
    while True:
        result = read.invoke('catalogue', {'scope': scope, **({'cursor': cursor} if cursor else {})})
        found.append(checked_batch(directory, result))
        cursor = result['next_cursor']
        if cursor is None:
            return found


def claims(directory, read, scope):
    return [claim for batch in pages(directory, read, scope) for claim in batch.claims]


def records(found, level=None):
    return [claim for claim in found if isinstance(claim, identity.RecordClaim) and level in (None, claim.level)]


def relations(found, type):
    return [claim for claim in found if isinstance(claim, identity.RelationClaim) and claim.type == type]


def identified(claim):
    """The open identifier a market or protocol record states for itself."""
    return claim.identifiers[0].value


def issues(result):
    return {item['code']: item['message'] for item in result['issues']}
