"""What the agent sees (the vision, "What the agent sees"; ADR 0044 A6): `pythia_instrument` gives the listing in use,
typed flags from a closed vocabulary and each identifier's provenance, all from data the read already loads.

The reference is the ASML fixture plus the identity truth-set subjects (`failures.json`: GSK and its pre-2022 ISIN,
Shell's London line, US Steel's delisted line); each flag comes from one of them or a one-row change to them.
"""
import contextlib
import json
import os
import sqlite3
from pathlib import Path
from unittest import mock

from test_agent_tools import ASML, AgentToolFixture, agent_tools, identity_ops
from test_identity_contracts import load, load_reference
from test_identity_evidence import add

ASML_SECURITY, OTHER_ISIN = "security:isin:NL0010273215", "NL0006034001"
GSK, GSK_BEFORE = "security:isin:GB00BN7SWP63", "security:isin:GB0009252882"
SHELL, SHEL = "security:isin:GB00BP6MXD84", "listing:isin:GB00BP6MXD84:XLON:GBP"
US_STEEL = "listing:provisional:sec:ticker:XNYS.1163302.X"
CURRENCY_GAP = {"code": "trading_currency_unknown", "detail": "A coverage gap: no source Pythia holds states this line's "
                "trading currency, and its venue does not fix one."}


class InstrumentFlagsTest(AgentToolFixture):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": str(Path(self.tmp.name) / "config")}))
        # The user trusts the installed package to confirm (the install command's grant).
        identity_ops.reference_package.install(Path(self.tmp.name) / "package", Path(self.tmp.name), "confirm")
        self.path = identity_ops.reference_package.current(Path(self.tmp.name))
        with self.reference() as db:
            load_reference(db, load("failures.json"))

    def reference(self):
        """The installed reference, to change one row the way a later build would."""
        @contextlib.contextmanager
        def opened():
            with contextlib.closing(sqlite3.connect(self.path)) as db, db:
                yield db
        return opened()

    def read(self, subject_id):
        result = json.loads(agent_tools.instrument({"subject_id": subject_id}))
        self.assertEqual(result["outcome"], "ok", result)
        return result["data"]

    def flags(self, subject_id):
        return {flag["code"]: flag.get("detail") for flag in self.read(subject_id)["flags"]}

    def test_a_settled_instrument_flags_only_its_currency_gap_and_names_each_identifiers_source(self):
        # ASML on Euronext Amsterdam, as in a real build: FIRDS gives the line no trading currency.
        data = self.read(ASML)
        self.assertEqual(data["flags"], [CURRENCY_GAP])
        self.assertEqual(data["provenance"]["isin"],  # the package contributes it, from GLEIF's record
                         {"source": "gleif", "plugin": "reference", "authority": "source_asserted", "level": "confirm"})
        self.assertEqual((data["provenance"]["lei"]["source"], data["provenance"]["cik"]["source"]), ("gleif", "sec"))
        # Each identifier shown has one; the listing's ticker, MIC and currency are its own row's.
        self.assertEqual(set(data["provenance"]), {"isin", "lei", "cik", "figi"})
        for key in ("queue", "contested", "open_identity_questions"):
            self.assertNotIn(key, data)

    def test_conflicting_identifier_gives_both_values_with_their_sources(self):
        add(self.path, ASML_SECURITY, "isin", OTHER_ISIN, "vendor")  # beside GLEIF's, at the package's confirm level
        data = self.read(ASML)
        flags = {flag["code"]: flag.get("detail") for flag in data["flags"]}
        self.assertEqual(flags["conflicting_identifier"], {"scheme": "isin", "values": [
            {"value": OTHER_ISIN, "sources": ["vendor"]}, {"value": "NL0010273215", "sources": ["GLEIF"]}]})
        self.assertNotIn("isin", data["identifiers"])  # neither value is applied, and neither has provenance
        self.assertNotIn("isin", data["provenance"])
        # Reading it asked the contested identifier as a question (ADR 0037, questions on touch).
        self.assertEqual(flags["identity_question_open"], {"count": 1, "reasons": ["identifier"]})

    def test_one_sources_two_values_are_no_conflicting_identifier(self):
        # OpenFIGI's two composite FIGIs for one composite: one source's several values contest nothing (#109).
        add(self.path, "composite:isin:NL0010273215:NL", "composite_figi", "BBG000K6MRN4", "openfigi")
        add(self.path, ASML_SECURITY, "isin", OTHER_ISIN, "gleif")  # GLEIF again, beside its own ISIN
        data = self.read(ASML)
        self.assertEqual(data["flags"], [CURRENCY_GAP])
        self.assertEqual(data["provenance"]["isin"]["source"], "gleif")

    def test_issuer_unknown_for_a_share_the_data_names_no_issuer_for(self):
        self.assertNotIn("issuer_unknown", self.flags(SHELL))
        with self.reference() as db:
            db.execute("UPDATE securities SET issuer_id = NULL WHERE id = ?", (SHELL,))
        self.assertIn("issuer_unknown", self.flags(SHELL))

    def test_trading_currency_unknown_for_a_line_that_quotes_in_minor_units(self):
        self.assertEqual(self.read(SHEL)["flags"], [CURRENCY_GAP])  # London quotes in pence or pounds

    def test_successor_in_both_directions_and_not_active_for_the_old_isin(self):
        self.assertEqual(self.flags(GSK)["successor"], {"succeeds": GSK_BEFORE})
        before = self.flags(GSK_BEFORE)
        self.assertEqual((before["successor"], before["not_active"]), ({"succeeded_by": GSK}, {"security": "inactive"}))

    def test_successor_while_the_old_isin_still_trades(self):
        # During a transition both ISINs trade: the old page lists the new one among the company's instruments too.
        with self.reference() as db:
            db.execute("UPDATE securities SET status = 'active' WHERE id = ?", (GSK_BEFORE,))
            db.execute("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, trading_currency,"
                       " is_primary, status) VALUES (?, ?, 'XLON', 'XLON', 'GSKO', 'GBP', 'GBP', 1, 'active')",
                       ("listing:isin:GB0009252882:XLON:GBP", GSK_BEFORE))
        data = self.read(GSK_BEFORE)
        self.assertIn(GSK, {item["id"] for item in data["other_securities"]})
        self.assertEqual({flag["code"]: flag.get("detail") for flag in data["flags"]}["successor"], {"succeeded_by": GSK})

    def test_not_active_for_a_delisted_line(self):
        self.assertEqual(self.flags(US_STEEL)["not_active"], {"security": "inactive", "listing": "inactive"})

    def test_the_home_note_says_the_listing_in_use_is_pythias_default(self):
        with self.reference() as db:
            db.execute("UPDATE listings SET is_primary = 0 WHERE id = ?", (SHEL,))
        data = self.read(SHELL)
        self.assertEqual((data["home"], data["subject"]["listing"]), ("unknown", SHEL))
        self.assertIn("the listing in use (subject.listing) is Pythia's default", data["home_note"])
