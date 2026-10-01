"""Every builder source can be left out of a build (ADR 0044, A1), a source left out decides nothing by its silence,
and the package lists the sources a build included."""

import json
import sqlite3
import tempfile
import unittest
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path
from unittest import mock

from reference_builder import assemble, claims, firds, linking, main, mic
from reference_builder.config import BuildConfig, Scope
from reference_builder.model import Evidence, Issuer, SecTicker, Security, Snapshot
from reference_builder.pipeline import build_snapshot

from .fixtures import (ASML_ISIN, ASML_LEI, MIC_CSV, NN_ISIN, SHELL_ISIN, SHELL_LEI, FakeOpenFigi, figi_row, firds_record,
                       fulins, sec_json)
from .test_claims import admissions
from .test_pipeline import OPENFIGI, gleif_fetch, inputs


def omitted(source: str):
    def refuse(*_args, **_kwargs):
        raise AssertionError(f"{source} read in a build without it")
    return refuse


class SourceFlagsTest(unittest.TestCase):
    def test_each_flag_leaves_its_source_out_and_firds_takes_fitrs_and_gleif_with_it(self):
        read = lambda config: (config.scope.firds, config.fitrs, config.gleif, config.openfigi, config.scope.sec)  # noqa: E731
        cases = {(): (True, True, True, True, True),
                 ("--no-gleif", "--no-openfigi"): (True, True, False, False, True),
                 ("--no-fitrs", "--no-sec"): (True, False, True, True, False),
                 ("--no-firds",): (False, False, False, True, True)}
        for flags, expected in cases.items():
            with self.subTest(flags=flags):
                self.assertEqual(read(main.parse_args(["--offline", *flags])), expected)  # offline: no SEC contact read
        self.assertEqual(read(BuildConfig(scope=Scope(firds=False), as_of=date(2026, 9, 26))), (False, False, False, True, True))
        self.assertEqual(main.parse_args(["--offline", "--no-firds"]).scope.label(), "US")

    def test_a_missing_figi_decides_nothing_when_openfigi_was_not_read(self):
        # NN has no FITRS result: without an OpenFIGI line too, its line is suspect, but only if OpenFIGI was asked.
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            asked, unread = (build_snapshot(assemble.Inputs(**{**inputs().__dict__, "openfigi": read}), gleif_fetch,
                                            FakeOpenFigi({})) for read in (True, False))
        line = f"XAMS:{NN_ISIN}"
        self.assertEqual((asked.listings[line].status, asked.listings[line].status_reasons[:1]), ("suspect", ["no_openfigi_line"]))
        self.assertEqual(unread.listings[line].status, "active")
        self.assertNotIn("no_openfigi_line", unread.listings[line].status_reasons)
        self.assertIn("no_openfigi_line", asked.listings["XNAS:AAPL"].status_reasons)
        self.assertNotIn("no_openfigi_line", unread.listings["XNAS:AAPL"].status_reasons)
        self.assertFalse([key for name in ("eu", "sec") for key in unread.audit[name] if "openfigi" in key])

    def test_without_gleif_a_share_its_receipts_claim_for_another_issuer_stays_a_question(self):
        # Nestlé S.A.'s CDR states the share FIRDS files under Nestlé Capital Markets. With GLEIF, a claim under a
        # retired LEI is stale (Merck Sharp & Dohme on Merck & Co.); without it no claim can be told stale.
        parent, vehicle = "KY37LUS27QQX7BB93L28", "549300PZN3NFSOUXLC42"
        merck, msd = "4YV9Y5M8S0BRK1RP0397", "MZK1AT00SJV4XB7WNL71"
        found = admissions(fulins([
            firds_record("CH0038863350", "XAMS", vehicle),
            firds_record("CA6410701073", "XAMS", parent, cfi="EDSXFR", underlying="CH0038863350"),
            firds_record("US58933Y1055", "XAMS", merck),
            firds_record("CA0000000002", "XAMS", msd, cfi="EDSXFR", underlying="US58933Y1055")]))
        given = assemble.Inputs(date(2026, 9, 26), Scope(mics=("XAMS",), sec=False), mic.parse(MIC_CSV.encode()), found,
                                None, [], {"XAMS"}, firds_claims=claims.load(firds.claims(found)), gleif=False)
        snap = build_snapshot(given, omitted("GLEIF"), FakeOpenFigi({}))
        asked = {q.subject_id: q.candidates for q in snap.questions if q.question == "issuer_identity"}
        self.assertEqual(asked, {"isin:CH0038863350": (f"lei:{parent}", f"lei:{vehicle}"),
                                 "isin:US58933Y1055": (f"lei:{msd}", f"lei:{merck}")})
        self.assertEqual({snap.securities[s].issuer_id for s in asked}, {None})
        self.assertNotIn("lei_not_in_gleif", {flag.flag for flag in snap.flags})

    def test_without_gleif_a_cik_whose_other_share_gleif_could_confirm_links_to_no_lei(self):
        # A registrant's US ISIN names its issuer's LEI (FIRDS field 5), and its other share, found by share-class FIGI,
        # has an issuer only GLEIF could confirm (field 5 names a venue operator's LEI). Unread, that claim might
        # contradict the first, so the CIK links to no LEI (linking.py, `link_issuer_unknown`); read, it links.
        us, other = "US1234567890", "CA1234567890"

        def decide(gleif_read: bool):
            snap = Snapshot(as_of="2026-09-26")
            snap.audit["sec"] = Counter()
            snap.issuers["lei:ACME"] = Issuer("lei:ACME", "ACME CORP SHARES", "esma_firds", lei="ACME", name_rule="firds_full_name")
            snap.securities[f"isin:{us}"] = Security(f"isin:{us}", "share", "esma_firds", Evidence.ADMISSION_REGISTER,
                                                     issuer_id="lei:ACME", isin=us)
            snap.securities[f"isin:{other}"] = Security(f"isin:{other}", "share", "esma_firds", Evidence.ADMISSION_REGISTER,
                                                        isin=other, share_class_figi="BBGACMESC002")
            tickers = [SecTicker("1000002", "ACME CORP", "ACME", "NYSE", 0)]
            figi = FakeOpenFigi({("ID_ISIN", us, "US"): [figi_row("ACME", "US", "BBGACMEUS001", "BBGACMESC001")]})
            rows = {"ACME": figi_row("ACME", "US", "BBGACMEUS002", "BBGACMESC002")}
            evidence, _isins = linking._link_evidence(snap, {}, tickers, rows, figi, {}, gleif_read)
            audit = Counter()
            return linking._decide(snap, tickers, evidence, audit), audit["link_issuer_unknown"]

        self.assertEqual(decide(gleif_read=False), ({}, 1))
        self.assertEqual(decide(gleif_read=True), ({"1000002": ("ACME", "isin_exch_us")}, 0))

    def test_a_sec_title_never_matches_a_firds_instrument_name(self):
        # Without GLEIF an issuer carries FIRDS' instrument name (field 2), which names a security, not the entity. Two
        # CIKs whose identifiers claim its LEI stay unlinked though one's SEC title reads like it (linking.py,
        # `_name_alike`); with the LEI's GLEIF name that CIK links (test_pipeline, the Lee Enterprises case).
        snap = Snapshot(as_of="2026-09-26")
        snap.issuers["lei:BRK"] = Issuer("lei:BRK", "BERKSHIRE HATHAWAY INC CLASS B", "esma_firds", lei="BRK",
                                         name_rule="firds_full_name")
        tickers = [SecTicker("58361", "LEE ENTERPRISES, Inc", "LEE", "NYSE", 0),
                   SecTicker("1067983", "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE", 1)]
        evidence = {"58361": [("BRK", "isin_exch_us", "record:lee")], "1067983": [("BRK", "share_class_figi", "record:brk")]}
        self.assertEqual(linking._decide(snap, tickers, evidence, Counter()), {})
        self.assertEqual({flag.flag for flag in snap.flags}, {"lei_contested_unnamed"})

    def build(self, tmp: Path, config: BuildConfig, figi=None, gleif=None) -> dict:
        archive = tmp / "FULINS_E_20260926_01of01.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr(archive.name.replace(".zip", ".xml"), fulins([
                firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"), firds_record(SHELL_ISIN, "XAMS", SHELL_LEI)]))
        codes, sec_file = tmp / "ISO10383_MIC.csv", tmp / "company_tickers_exchange.json"
        codes.write_text(MIC_CSV)
        sec_file.write_bytes(sec_json([(320193, "Apple Inc.", "AAPL", "Nasdaq")]))

        class Figi:
            keyed = False

            def __init__(self, *_args):
                self.map = FakeOpenFigi(OPENFIGI)

            def mic_codes(self):
                return {"XAMS"}

            def provenance(self):
                return {"answers_to": None}

        firds_files = (lambda *a: ([{"file_name": archive.name}], [])) if config.scope.firds else omitted("FIRDS")
        with mock.patch.object(main.mic, "fetch", lambda downloads, _age: downloads.register_local("iso10383_mic", codes) and MIC_CSV.encode()), \
                mock.patch.object(main.firds, "firds_files", firds_files), \
                mock.patch.object(main.firds, "download", lambda downloads, source, _doc: downloads.register_local(source, archive).path), \
                mock.patch.object(main, "OpenFigi", figi or Figi), mock.patch.object(main, "GleifClient", gleif), \
                mock.patch.object(main, "load_openfigi_key", lambda: None), \
                mock.patch.object(main.truth_report, "build_report", lambda *a: {}), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            self.assertEqual(main.run(replace_paths(config, tmp, sec_file)), 0)
        return json.loads((tmp / "out" / "package.json").read_text())

    def test_a_build_without_openfigi_and_gleif_opens_neither_and_lists_what_it_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = BuildConfig(scope=Scope(mics=("XAMS",), sec=False), as_of=date(2026, 9, 26), fitrs=False,
                                 gleif=False, openfigi=False)
            package = self.build(Path(tmp), config, figi=omitted("OpenFIGI"), gleif=omitted("GLEIF"))
            self.assertEqual(package["included_sources"], ["iso10383_mic", "esma_firds", "canonical_assets"])
            self.assertEqual({entry["source"].split(":")[0] for entry in package["sources"]}, set(package["included_sources"]))
            self.assertEqual([(canary["name"], canary["ok"]) for canary in package["quality"]["canaries"]],
                             [("ASML on Euronext Amsterdam", True)])

    def test_a_build_without_firds_is_a_us_view(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = BuildConfig(scope=Scope(firds=False), as_of=date(2026, 9, 26))
            package = self.build(Path(tmp), config, gleif=omitted("GLEIF"))
            self.assertEqual(package["included_sources"], ["iso10383_mic", "sec_company_tickers", "openfigi", "canonical_assets"])
            self.assertEqual([canary["name"] for canary in package["quality"]["canaries"]], ["Apple on Nasdaq"])
            self.assertFalse(any(path.name.startswith("firds-") for path in (Path(tmp) / "out").iterdir()))
            with sqlite3.connect(Path(tmp) / "out" / package["database"]["file"]) as db:
                scope = db.execute("SELECT value FROM release WHERE key = 'scope'").fetchone()
                equities = db.execute("SELECT count(*) FROM listings WHERE mic IS NOT NULL AND mic <> 'XNAS'").fetchone()
            self.assertEqual((scope, equities), (("US",), (0,)))


def replace_paths(config: BuildConfig, tmp: Path, sec_file: Path) -> BuildConfig:
    return BuildConfig(**{**config.__dict__, "out_dir": tmp / "out", "cache_dir": tmp / "cache",
                          "sec_file": sec_file if config.scope.sec else None})


if __name__ == "__main__":
    unittest.main()
