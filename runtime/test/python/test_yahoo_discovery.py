"""Synthetic response shape from the public Yahoo trending endpoint; no network."""
import importlib.util
import io
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('yahoo_trending_test', Path(__file__).resolve().parents[2] / 'managed/plugins/yahoo-discovery/trending.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Opener:
    def __init__(self, data):
        self.raw = json.dumps(data).encode()

    def open(self, request, timeout):
        assert request.full_url == module.URL
        assert timeout == 8
        return io.BytesIO(self.raw)


class TrendingTests(unittest.TestCase):
    def test_native_symbols_and_missing_timestamp(self):
        data = module.read(Opener({'finance': {'result': [{'quotes': [{'symbol': 'ONE'}, {'symbol': '^SYNTH'}]}]}}))
        self.assertEqual(data['symbols'], ['ONE', '^SYNTH'])
        self.assertIsNone(data['as_of'])
        self.assertNotIn('prices', data)

    def test_bounded_unambiguous_response(self):
        for quotes in [[{'symbol': 'ONE'}] * 2, [{'symbol': 'unsafe/url'}], [{'symbol': f'S{i}'} for i in range(6)]]:
            with self.assertRaises(ValueError):
                module.read(Opener({'finance': {'result': [{'quotes': quotes}]}}))
        huge = Opener({})
        huge.raw = b'x' * 65537
        with self.assertRaises(ValueError):
            module.read(huge)
