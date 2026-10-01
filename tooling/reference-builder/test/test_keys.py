"""Keys come from identifiers, never from a source (ADR 0037, `subject_key@2`): a CGS-area ISIN without a FIGI keys
one device-local subject whatever its source, and references saved under subject_key@1's FIRDS-namespaced IDs follow it."""

import copy
import importlib
import json
import tempfile
import unittest
from contextlib import closing
from dataclasses import replace
from pathlib import Path
from unittest import mock

from reference_builder import schema, writer
from reference_builder.pipeline import build_snapshot

from .fixtures import FakeOpenFigi
from .test_pipeline import APPLE_ISIN, UNKNOWN_US_ISIN, WIDE_OPENFIGI, gleif_fetch, wide_inputs

identity = schema.identity
lifecycle, reference_package, store, subject = (importlib.import_module(f"{identity.__name__}.{name}")
                                                for name in ("lifecycle", "reference_package", "store", "subject"))
# Microsoft's ISIN on the Frankfurt open market, which OpenFIGI does not answer in the fixture.
SECURITY, LINE = f"security:cgs_isin:{UNKNOWN_US_ISIN}", f"listing:cgs_isin:{UNKNOWN_US_ISIN}:XFRA:EUR"
FORMER = {SECURITY: f"security:provisional:esma_firds:isin:{UNKNOWN_US_ISIN}",  # subject_key@1's IDs
          LINE: f"listing:provisional:esma_firds:line:XFRA.{UNKNOWN_US_ISIN}.EUR"}
EODHD = identity.ProviderRef("eodhd", "MSF.F", "catalogue")


def written(snap) -> tuple[set[str], dict[str, str]]:
    tables = schema.rows(snap, {"build_id": "test"}, [])
    ids = {row["id"] for name in ("securities", "listings") for row in tables[name]}
    return ids, {row["old_id"]: row["new_id"] for row in tables["id_aliases"]}


class CgsKeyTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.snap = build_snapshot(wide_inputs(), gleif_fetch, FakeOpenFigi(WIDE_OPENFIGI))

    def test_a_cgs_isin_without_a_figi_keys_one_device_local_subject_whatever_its_source(self):
        renamed = copy.deepcopy(self.snap)
        for row in (*renamed.issuers.values(), *renamed.securities.values(), *renamed.listings.values()):
            row.source = f"another_{row.source}"
        for snap in (self.snap, renamed):
            ids, aliases = written(snap)
            self.assertLessEqual({SECURITY, LINE}, ids)
            self.assertEqual({old: aliases.get(old) for old in FORMER.values()}, {old: new for new, old in FORMER.items()})
            self.assertFalse(any(":provisional:" in value for value in ids if UNKNOWN_US_ISIN in value))

    def test_a_figi_keyed_security_keeps_its_id_and_every_local_form_aliases_to_it(self):
        ids, aliases = written(self.snap)
        apple, line = "security:figi:BBG001S5N8V8", "listing:figi:BBG000BPCGF6"  # Apple's Frankfurt line
        self.assertLessEqual({apple, line}, ids)
        for old in (f"security:cgs_isin:{APPLE_ISIN}", f"security:provisional:esma_firds:isin:{APPLE_ISIN}"):
            self.assertEqual(aliases[old], apple)
        for old in (f"listing:cgs_isin:{APPLE_ISIN}:XFRA:USD", f"listing:provisional:esma_firds:line:XFRA.{APPLE_ISIN}.USD"):
            self.assertEqual(aliases[old], line)

    def test_the_re_key_carries_references_saved_under_the_former_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference-20261001" / "reference-20261001.sqlite3"  # a release is named by its directory
            path.parent.mkdir()
            writer.write(self.snap, path, {"build_id": "reference-20261001"}, [])
            saved = store.IdentityStore(Path(tmp) / "store")
            with closing(store.open_reference(path)) as ref:
                isin = subject._assertion(ref.execute("SELECT * FROM assertions WHERE subject_id = ? AND scheme = 'isin'",
                                                      (SECURITY,)).fetchone())
                cited = replace(isin, subject_id=FORMER[SECURITY]).evidence_id  # as subject_key@1's build wrote it
                self.assertTrue(saved.put_binding(identity.Binding(EODHD, FORMER[LINE], "confirmed", "source_asserted",
                                                                   (cited,), "pythia-eodhd")))
                saved.put_miss(FORMER[SECURITY], "pythia-yahoo", "no match", 3600)
                result = lifecycle.rekey(saved, ref, reference_package.release_key(path))
                watched = subject.current_id(ref, FORMER[SECURITY])  # an ID saved in settings, resolved on read
            bound = saved.binding_for(EODHD)
            self.assertEqual((bound["subject_id"], json.loads(bound["evidence_ids"])), (LINE, [isin.evidence_id]))
            self.assertEqual((saved.misses(SECURITY), saved.misses(FORMER[SECURITY])), ({"pythia-yahoo": "no match"}, {}))
            self.assertEqual((result["vanished"], lifecycle.vanished(saved), watched), (0, [], SECURITY))
            saved.db.close()


if __name__ == "__main__":
    unittest.main()
