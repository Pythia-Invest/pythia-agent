"""Every builder source can be left out of a build (ADR 0044, A1), and the package lists the sources it includes."""

import json
import sqlite3
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest import mock

from reference_builder import main
from reference_builder.config import BuildConfig, Scope

from .fixtures import ASML_ISIN, ASML_LEI, MIC_CSV, SHELL_ISIN, SHELL_LEI, FakeOpenFigi, firds_record, fulins, sec_json
from .test_pipeline import OPENFIGI, gleif_fetch

ALL = ["iso10383_mic", "esma_firds", "esma_fitrs", "gleif", "openfigi", "sec", "canonical_assets"]


def omitted(source: str):
    def refuse(*_args, **_kwargs):
        raise AssertionError(f"{source} read in a build without it")
    return refuse


class SourceFlagsTest(unittest.TestCase):
    def test_each_flag_leaves_its_source_out_and_firds_takes_fitrs_and_gleif_with_it(self):
        cases = {(): ALL,
                 ("--no-gleif", "--no-openfigi"): ["iso10383_mic", "esma_firds", "esma_fitrs", "sec", "canonical_assets"],
                 ("--no-fitrs", "--no-sec"): ["iso10383_mic", "esma_firds", "gleif", "openfigi", "canonical_assets"],
                 ("--no-firds",): ["iso10383_mic", "openfigi", "sec", "canonical_assets"]}
        for flags, included in cases.items():
            with self.subTest(flags=flags):
                config = main.parse_args(["--offline", *flags])  # offline: no SEC contact is read
                self.assertEqual(config.included_sources(), included)
        self.assertEqual(main.parse_args(["--offline", "--no-firds"]).scope.label(), "US")

    def build(self, tmp: Path, config: BuildConfig, figi=None, gleif=None) -> dict:
        archive = tmp / "FULINS_E_20260926_01of01.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr(archive.name.replace(".zip", ".xml"), fulins([
                firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"), firds_record(SHELL_ISIN, "XAMS", SHELL_LEI)]))
        sec_file = tmp / "company_tickers_exchange.json"
        sec_file.write_bytes(sec_json([(320193, "Apple Inc.", "AAPL", "Nasdaq")]))

        class Figi:
            keyed = False

            def __init__(self, *_args):
                self.map = FakeOpenFigi(OPENFIGI)

            def mic_codes(self):
                return {"XAMS"}

            def provenance(self):
                return {"answers_to": None}

        class Gleif:
            calls = 0

            def __init__(self, *_args):
                self.fetch = gleif_fetch

            def provenance(self):
                return None

        firds_files = (lambda *a: ([{"file_name": archive.name}], [])) if config.scope.firds else omitted("FIRDS")
        with mock.patch.object(main.mic, "fetch", lambda *a: MIC_CSV.encode()), \
                mock.patch.object(main.firds, "firds_files", firds_files), \
                mock.patch.object(main.firds, "download", lambda *a: str(archive)), \
                mock.patch.object(main, "OpenFigi", figi or Figi), mock.patch.object(main, "GleifClient", gleif or Gleif), \
                mock.patch.object(main, "load_openfigi_key", lambda: None), \
                mock.patch.object(main.truth_report, "build_report", lambda *a: {}), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            self.assertEqual(main.run(replace_paths(config, tmp, sec_file)), 0)
        return json.loads((tmp / "out" / "package.json").read_text())

    def test_a_build_without_openfigi_and_gleif_decides_nothing_from_their_silence(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = BuildConfig(scope=Scope(mics=("XAMS",), sec=False), as_of=date(2026, 9, 26), fitrs=False,
                                 gleif=False, openfigi=False)
            package = self.build(Path(tmp), config, figi=omitted("OpenFIGI"), gleif=omitted("GLEIF"))
            self.assertEqual(package["included_sources"], ["iso10383_mic", "esma_firds", "canonical_assets"])
            self.assertEqual([(canary["name"], canary["ok"]) for canary in package["quality"]["canaries"]],
                             [("ASML on Euronext Amsterdam", True)])
            with sqlite3.connect(Path(tmp) / "out" / package["database"]["file"]) as db:
                status = db.execute("SELECT status FROM listings WHERE id = ?", (f"listing:isin:{ASML_ISIN}:XAMS:EUR",)).fetchone()
            self.assertEqual(status, ("active",), "a line OpenFIGI was not asked about is no less active")

    def test_a_build_without_firds_is_a_us_view(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = BuildConfig(scope=Scope(firds=False), as_of=date(2026, 9, 26), fitrs=False, gleif=False)
            package = self.build(Path(tmp), config, gleif=omitted("GLEIF"))
            self.assertEqual(package["included_sources"], ["iso10383_mic", "openfigi", "sec", "canonical_assets"])
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
