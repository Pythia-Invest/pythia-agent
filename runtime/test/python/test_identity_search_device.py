"""Search over the reference and the device (roadmap stage 0; ADR 0037, amendment "search over reference and device").

A plugin's subjects appear in search like the reference's, ranked by the same rules and never by origin, and leave it
while their plugin is disabled; their pages still open by ID. With no package installed, search reads the device's
subjects alone and a saved instrument opens as a labelled stub. Removing the package and installing it again re-keys
nothing and retires no question. Search writes nothing and calls no provider. Device rows are written through the
store's API, as ingest writes them.
"""
import contextvars
import json
import sqlite3
import sys
import types
import unittest
from contextlib import closing
from dataclasses import replace
from unittest import mock

from test_identity_contracts import load, load_reference
from test_identity_trust import TrustCase, identity, identity_ops, page, reference_package, store, trust
from test_reference_package import make_package
from pythia_core_queue_fixture import queue_ops  # noqa: E402  (the core test_identity_trust loaded)
from pythia_core_queue_fixture.identity import device, lifecycle, search, search_device, search_index  # noqa: E402
from pythia_core_queue_fixture.platform.request_context import usage  # noqa: E402

NOW = "2026-09-30T10:00:00Z"
ASML, ASML_SECURITY = "listing:isin:NL0010273215:XAMS:EUR", "security:isin:NL0010273215"
ASML_XETRA = "listing:isin:NL0010273215:XETR:EUR"  # FIRDS lists it with no ticker
ASML_GROUP = "issuer:lei:724500Y6DUVHQD6OXN27"
SAP, SAP_XETRA = "security:isin:DE0007164600", "listing:isin:DE0007164600:XETR:EUR"
POOL, PROTOCOL = "market:provisional:poolsource:pool:usdc-navi", "protocol:provisional:poolsource:protocol:navi"
GLOBEX, GLOBEX_TSX = "listing:provisional:fixture:line:globex", "listing:provisional:lister:line:globex"
RIGHTS = {"licence": "open", "cache": "unlimited", "hostable": False}
LISTER = page.PluginInfo(key="pythia-lister", operations={"resolve": "lister_resolve"}, manifest=identity.validate_manifest({
    # A listings source core never names, at confirm level: it introduces lines and looks records up by ISIN.
    "contract_version": 2, "plugin": "lister", "provider": "lister",
    "addressing": {"native": [{"native_scope": "line", "level": "listing"}]},
    "introduces": {"listing": ["isin", "native"], "security": ["isin"]},
    "resolve": {"operation": "resolve", "input_schemes": ["isin"], "echoes": []},
    "rights": RIGHTS, "signoff": {"status": "grandfathered"}}))


def pools(provider: str, status: str = "unsigned") -> page.PluginInfo:
    """A DeFi source core never names, introducing pools and protocols: display level unless `status` confirms it."""
    return page.PluginInfo(key=f"{provider}-plugin", manifest=identity.validate_manifest({
        "contract_version": 2, "plugin": f"{provider}-plugin", "provider": provider,
        "addressing": {"native": [{"native_scope": "pool", "level": "market"},
                                  {"native_scope": "protocol", "level": "protocol"}]},
        "introduces": {"market": ["native"], "protocol": ["native"]}, "rights": RIGHTS, "signoff": {"status": status}}))


POOLS = pools("poolsource")


def place(at, info, native_id, subject, *, scope=None, state="introduced", name=None, stated=()):
    """One record of `info` kept and placed on `subject` as ingest places it, with the identifiers it states
    (`stated`: (subject, scheme, value)), then a new generation."""
    manifest = info.manifest
    ref = identity.ProviderRef(manifest.provider, native_id, scope or manifest.native[0].native_scope)
    at.put_claim(manifest.plugin, manifest.provider, {"level": identity.subject_kind(subject), "native_ref": ref.wire(),
                                                      "attributes": {"name": name} if name else {}})
    device.place_claim(at, manifest.plugin, ref, subject, state)
    for owner, scheme, value in stated:
        device.put_assertion(at, owner, scheme, value, plugin=manifest.plugin, ref=ref)
    device.bump(at)


def introduce_sap(at) -> None:
    """SAP's Xetra line under a SAP security, both introduced by the lister, which states the security's ISIN."""
    device.put_subject(at, SAP, plugin="lister", name="SAP SE", attributes={"asset_class": "equity", "kind": "ordinary"})
    device.put_subject(at, SAP_XETRA, plugin="lister", name="SAP SE", parent_id=SAP,
                       attributes={"ticker": "SAP", "operating_mic": "XETR", "currency": "EUR"})
    place(at, LISTER, "SAP-XETR", SAP_XETRA, name="SAP SE",
          stated=[(SAP, "isin", "DE0007164600"), (SAP_XETRA, "ticker_mic", "SAP@XETR")])


def introduce_pool(at, info=POOLS, native_id="usdc-navi", name="USDC lending on Navi", rank=None) -> str:
    """A lending pool the DeFi source introduced, and its protocol."""
    pool = identity.provisional_id(identity.Kind.MARKET, info.manifest.provider, "pool", native_id)
    device.put_subject(at, pool, plugin=info.manifest.plugin, name=name,
                       attributes={"asset_class": "crypto", **({"rank": rank} if rank else {})})
    place(at, info, native_id, pool, name=name)
    return pool


class DeviceSearch(TrustCase):
    """A device with the hand-written reference (ASML, Ericsson and others) installed at confirm level."""

    def setUp(self):
        super().setUp()
        self.reference = self.root / "reference.sqlite3"
        with closing(sqlite3.connect(self.reference)) as db, db:
            db.executescript(identity.schema_sql("reference"))
            for name in ("asml.json", "failures.json"):
                load_reference(db, load(name))
            db.execute("INSERT INTO listings (id, security_id, mic, operating_mic, currency, trading_currency) VALUES"
                       " (?, ?, 'XETR', 'XETR', 'EUR', 'EUR')", (ASML_XETRA, ASML_SECURITY))
            db.execute("INSERT INTO securities (id, name, asset_class, kind, rank) VALUES"
                       " ('security:provisional:fixture:id:globex', 'Globex Corporation', 'equity', 'ordinary', 5000)")
            db.execute("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency) VALUES"
                       " (?, 'security:provisional:fixture:id:globex', 'XNYS', 'XNYS', 'GBX', 'USD')", (GLOBEX,))
        self.package = make_package(self.root / "package", source=self.reference)
        self.data = self.root / "data"
        reference_package.install(self.package, self.data, trust.CONFIRM)
        self.plugins = [LISTER, POOLS]
        self.enterContext(mock.patch.object(identity_ops, "installed", lambda: self.plugins))
        self.enterContext(mock.patch.object(identity_ops.search_venues, "priced", dict))  # no quote plugin installed
        self.ops = self.identity(self.data)

    def identity(self, data):
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=data)
        self.addCleanup(lambda: ops._store and ops._store.db.close())
        return ops

    def search(self, query, ops=None, desk=False):
        """The search answer, as the agent reads it, or with `desk` as the Desk does."""
        context = contextvars.copy_context()
        if desk:
            context.run(usage.set, "dashboard")
        return json.loads(context.run((ops or self.ops).search, {"query": query}))

    def groups(self, query, ops=None):
        return [group["id"] for group in self.search(query, ops)["data"]["groups"]]


class FoundTest(DeviceSearch):
    def test_an_introduced_subject_is_found_by_name_and_by_identifier_with_its_plugins_label(self):
        introduce_sap(self.ops.store)
        introduce_pool(self.ops.store)
        device.put_subject(self.ops.store, PROTOCOL, plugin="poolsource-plugin", name="Navi")
        place(self.ops.store, POOLS, "navi", PROTOCOL, scope="protocol", name="Navi")
        for query in ("sap se", "SAP", "DE0007164600"):
            with self.subTest(query=query):
                group = self.search(query)["data"]["groups"][0]
                self.assertEqual((group["id"], group["name"], group["kind"], group["listings"]), (SAP, "SAP SE", "ordinary", 1))
                self.assertEqual(group["rows"], [{"id": SAP_XETRA, "instrument": SAP, "ticker": "SAP", "name": "SAP SE",
                                                  "kind": "ordinary", "mic": "XETR", "venue": None, "country": None,
                                                  "currency": "EUR", "source": "lister"}])
        # A pool and a protocol are each their own group, named by their label, with no ticker.
        found = {group["id"]: group for group in self.search("navi")["data"]["groups"]}
        self.assertEqual({key: (group["kind"], group["name"], group["rows"][0]["ticker"], group["rows"][0]["source"])
                          for key, group in found.items()},
                         {POOL: ("market", "USDC lending on Navi", None, "poolsource"),
                          PROTOCOL: ("protocol", "Navi", None, "poolsource")})
        # The reference's own lines carry no plugin label.
        self.assertNotIn("source", self.search("asml")["data"]["groups"][0]["rows"][0])

    def test_a_disabled_plugins_subjects_leave_search_and_their_pages_still_open(self):
        introduce_sap(self.ops.store)
        pool = introduce_pool(self.ops.store)
        self.plugins = [replace(LISTER, enabled=False), replace(POOLS, enabled=False)]
        self.assertEqual((self.groups("sap se"), self.groups("DE0007164600"), self.groups("navi")), ([], [], []))
        for subject, name in ((SAP_XETRA, "SAP SE"), (pool, "USDC lending on Navi")):
            body = json.loads(queue_ops.read_subject(self.ops, {"subject_id": subject}))
            self.assertEqual((body["outcome"], body["data"]["subject"]["name"]), ("ok", name))
            self.assertEqual(body["data"]["contributors"][0]["status"], "disabled")
        self.plugins = [LISTER, POOLS]  # enabled again: back at once, nothing re-synced
        self.assertEqual((self.groups("sap se"), self.groups("navi")), ([SAP], [pool]))

    def test_a_plugins_ticker_makes_a_ticker_less_reference_line_findable(self):
        # FIRDS lists ASML's Xetra line with no ticker, so search leaves it out.
        self.assertEqual(self.groups("QW9"), [])
        self.assertEqual(self.search("asml")["data"]["groups"][0]["listings"], 2)
        place(self.ops.store, LISTER, "ASML-XETR", ASML_XETRA, state="joined", name="ASML Holding NV",
              stated=[(ASML_XETRA, "ticker_mic", "QW9@XETR")])
        group, = self.search("QW9")["data"]["groups"]
        self.assertEqual((group["id"], group["listings"]), (ASML_GROUP, 3))
        self.assertEqual({key: group["rows"][0][key] for key in ("id", "ticker", "currency")},
                         {"id": ASML_XETRA, "ticker": "QW9", "currency": "EUR"})
        self.assertNotIn("source", group["rows"][0])  # the line is the reference's; the plugin only stated its ticker
        self.plugins = [replace(LISTER, enabled=False), POOLS]  # the reference's own line is back as it was
        self.assertEqual((self.groups("QW9"), self.search("asml")["data"]["groups"][0]["listings"]), ([], 2))

    def test_a_plugins_line_under_a_reference_security_joins_its_company_whatever_kind_it_states(self):
        shown = replace(LISTER, manifest=identity.vouched(LISTER.manifest, trust.DISPLAY))
        self.plugins, line = [shown, POOLS], "listing:provisional:lister:line:asml-tokyo"
        device.put_subject(self.ops.store, line, plugin="lister", name="ASML", parent_id=ASML_SECURITY, attributes={
            "ticker": "ASMLJ", "operating_mic": "XJPX", "currency": "JPY", "kind": "etf", "asset_class": "crypto"})
        place(self.ops.store, shown, "ASMLJ", line, name="ASML")
        group = self.search("asml")["data"]["groups"][0]
        self.assertEqual((group["id"], group["kind"], group["listings"]), (ASML_GROUP, "ordinary", 3))
        self.assertEqual({row["id"]: row["kind"] for row in self.search("ASMLJ")["data"]["groups"][0]["rows"]}[line],
                         "ordinary")  # the security's kind, not the record's

    def test_with_no_package_search_reads_the_device_alone(self):
        bare = self.identity(self.root / "bare")
        introduce_sap(bare.store)
        pool = introduce_pool(bare.store)
        self.assertEqual((self.groups("SAP", bare), self.groups("DE0007164600", bare), self.groups("navi", bare)),
                         ([SAP], [SAP], [pool]))
        self.assertNotIn("issues", self.search("SAP", bare))
        nothing = self.search("asml", bare)
        self.assertEqual((nothing["outcome"], nothing["issues"][0]["message"]), ("empty", queue_ops.NO_REFERENCE))


class RankingTest(DeviceSearch):
    def test_rank_and_text_decide_never_origin(self):
        at, query = self.ops.store, "globex corporation"
        device.put_subject(at, GLOBEX_TSX, plugin="lister", name="Globex Corporation",
                           attributes={"ticker": "GBXT", "operating_mic": "XTSE", "currency": "CAD", "kind": "ordinary",
                                       "asset_class": "equity", "rank": {"market_cap_usd": 2e11}})
        place(at, LISTER, "GBXT", GLOBEX_TSX, name="Globex Corporation")
        self.assertEqual(self.groups(query)[0], GLOBEX_TSX)  # a plugin's more notable line leads the reference's
        device.put_subject(at, GLOBEX_TSX, plugin="lister", attributes={
            "ticker": "GBXT", "operating_mic": "XTSE", "currency": "CAD", "kind": "ordinary", "asset_class": "equity",
            "rank": {"market_cap_usd": 1e7}})
        device.bump(at)
        self.assertEqual(self.groups(query)[0], "security:provisional:fixture:id:globex")

    def test_trust_breaks_a_tie(self):
        confirmed = pools("zetapools", "grandfathered")  # its pool's ID sorts after the display source's
        self.plugins = [LISTER, POOLS, confirmed]
        shown = introduce_pool(self.ops.store, POOLS, "blue", "Blue Pool USDC")
        proved = introduce_pool(self.ops.store, confirmed, "blue", "Blue Pool USDC")
        self.assertEqual(self.groups("blue pool"), [proved, shown])
        self.plugins = [LISTER, replace(POOLS, manifest=identity.vouched(POOLS.manifest, trust.CONFIRM)),
                        replace(confirmed, manifest=identity.vouched(confirmed.manifest, trust.DISPLAY))]
        self.assertEqual(self.groups("blue pool"), [shown, proved])

    def test_a_contested_identifier_finds_neither_value(self):
        # A confirm-level plugin states another ISIN for ASML's share than the package: neither value applies.
        place(self.ops.store, LISTER, "ASML-AMS", ASML, state="joined", stated=[(ASML_SECURITY, "isin", "DE0007164600")])
        self.assertEqual((self.groups("NL0010273215"), self.groups("DE0007164600")), ([], []))
        self.assertEqual(self.groups("asml")[0], ASML_GROUP)  # still found by its name
        self.plugins = [replace(LISTER, manifest=identity.vouched(LISTER.manifest, trust.DISPLAY)), POOLS]
        self.assertEqual((self.groups("NL0010273215"), self.groups("DE0007164600")), ([ASML_GROUP], []))


class ReadOnlyTest(DeviceSearch):
    def test_a_device_change_renews_the_device_part_and_never_rebuilds_the_reference(self):
        introduce_sap(self.ops.store)
        self.search("sap")
        built = search._cache["current"][1]
        renewed = mock.patch.object(built, "renew", wraps=built.renew)
        with mock.patch.object(search_index.Index, "_load", side_effect=AssertionError("the reference rebuilt")), \
                renewed as renew:
            self.search("asml")
            self.search("navi")
            json.loads(queue_ops.read_subject(self.ops, {"subject_id": ASML}))  # a page read uses the same directory
            renew.assert_not_called()  # nothing changed: nothing renewed
            pool = introduce_pool(self.ops.store)  # a write bumps the store's generation
            self.assertEqual(self.groups("navi"), [pool])
            self.plugins = [LISTER, replace(POOLS, enabled=False)]
            self.assertEqual(self.groups("navi"), [])
            self.assertEqual(renew.call_count, 2)
        self.assertIs(search._cache["current"][1], built)

    def test_search_writes_nothing_and_calls_no_provider_and_offers_lookups(self):
        introduce_sap(self.ops.store)
        introduce_pool(self.ops.store)
        self.ops.reference_path()  # the release's first use carries local rows to it (Lifecycle A), not search
        before = list(self.ops.store.db.iterdump())
        registry = types.ModuleType("tools.registry")
        registry.registry = mock.Mock()
        with mock.patch.dict(sys.modules, {"tools": types.ModuleType("tools"), "tools.registry": registry}):
            answers = {query: self.search(query, desk=True)
                       for query in ("sap", "navi", "NL0010273215", "DE0007164600", "asml")}
            json.loads(self.ops.search({"group": ASML_GROUP}))
        registry.registry.dispatch.assert_not_called()
        self.assertEqual(list(self.ops.store.db.iterdump()), before)
        # An identifier the lister's resolve takes offers its lookup on the Desk, found or not; text, the agent and a
        # disabled plugin get none.
        offer = [{"plugin": "pythia-lister", "label": "lister"}]
        self.assertEqual({query: body["data"]["lookup"] for query, body in answers.items()},
                         {"sap": [], "navi": [], "NL0010273215": offer, "DE0007164600": offer, "asml": []})
        self.assertEqual(self.search("NL0010273215000", desk=True)["data"]["lookup"], [])  # not an ISIN
        self.assertEqual(self.search("NL0010273215")["data"]["lookup"], [])  # the agent cannot run a Desk lookup
        self.plugins = [replace(LISTER, enabled=False), POOLS]
        self.assertEqual(self.search("NL0010273215", desk=True)["data"]["lookup"], [])


class OverlayTest(DeviceSearch):
    """The device's part, laid over the reference's in place, is what a build from scratch gives."""

    def assert_as_built(self):
        self.search("sap")  # lays the device's current state
        laid = search._cache["current"][1]
        with closing(store.open_reference(reference_package.current(self.data))) as ref:
            fresh = search.Directory(ref)
            fresh.renew(ref, search_device.additions(ref, store=self.ops.store, plugins=self.plugins), ("fresh",))
        rows = lambda index: sorted(row[1:] for row in index.db.execute("SELECT * FROM doc"))  # noqa: E731
        self.assertEqual(rows(laid), rows(fresh))
        self.assertEqual(sorted(laid.db.execute("SELECT * FROM gsize")), sorted(fresh.db.execute("SELECT * FROM gsize")))
        self.assertEqual(dict(laid.vocab), dict(fresh.vocab))
        laid.db.execute("INSERT INTO fts(fts, rank) VALUES ('integrity-check', 1)")  # the FTS index matches its rows
        for query in ("sap", "asml", "QW9", "navi", "NL0010273215", "DE0007164600", "scallop"):
            self.assertEqual(laid.search(query, limit=20), fresh.search(query, limit=20), query)
        fresh.db.close()

    def test_adding_dropping_and_disabling_leaves_what_a_full_build_gives(self):
        at, xetra = self.ops.store, identity.ProviderRef("lister", "ASML-XETR", "line")
        introduce_sap(at)
        introduce_pool(at)
        place(at, LISTER, "ASML-XETR", ASML_XETRA, state="joined", name="ASML Holding NV",
              stated=[(ASML_XETRA, "ticker_mic", "QW9@XETR")])
        place(at, LISTER, "ASML-AMS", ASML, state="joined", stated=[(ASML_SECURITY, "isin", "DE0007164600")])
        self.assert_as_built()
        device.place_claim(at, "lister", xetra, ASML_XETRA, "not_seen")  # no longer offered: its ticker goes
        device.bump(at)
        self.assert_as_built()
        self.plugins = [LISTER, replace(POOLS, enabled=False)]  # the pools and their words go
        self.assert_as_built()
        self.assertNotIn("navi", search._cache["current"][1].vocab)
        introduce_pool(at, native_id="scallop-sui", name="SUI lending on Scallop")
        self.plugins = [replace(LISTER, manifest=identity.vouched(LISTER.manifest, trust.DISPLAY)), POOLS]
        self.assert_as_built()  # both pools back; the ISIN no longer contested

    def test_a_pools_protocol_never_rebuilds_the_reference_and_a_failed_renew_is_not_kept(self):
        confirmed = pools("zetapools", "grandfathered")
        self.plugins = [LISTER, confirmed]
        pool = introduce_pool(self.ops.store, confirmed, "blue", "Blue Pool USDC")
        self.search("sap")
        with mock.patch.object(search_index.Index, "_load", side_effect=AssertionError("the reference rebuilt")):
            self.ops.store.db.execute(  # a confirm-level plugin's `part_of`: one target, but not a fold
                "INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin, retrieved_at)"
                " VALUES ('ev:part-of', 'part_of', ?, ?, 'source_asserted', 'zetapools', 'zetapools-plugin', ?)",
                (pool, "protocol:provisional:zetapools:protocol:blue", NOW))
            device.bump(self.ops.store)
            self.assertEqual(self.groups("blue pool"), [pool])
        device.bump(self.ops.store)
        with mock.patch.object(search_index.Index, "renew", side_effect=sqlite3.OperationalError("disk I/O error")):
            self.assertIn("Search is unavailable", self.search("sap")["issues"][0]["message"])
        self.assertNotIn("current", search._cache)  # a half-laid index is never served
        self.assertEqual(self.groups("blue pool"), [pool])


class RemovalTest(DeviceSearch):
    def test_removing_the_package_leaves_stubs_and_device_evidence_and_reinstalling_re_keys_nothing(self):
        at = self.ops.store
        self.ops.reference_path()  # the release's first use
        place(at, LISTER, "ASML-AMS", ASML, state="joined", name="ASML Holding NV", stated=[(ASML, "figi", "BBG000C1HT47")])
        at.put_queue_item(identity.QueueItem(
            id="build-1", kind="conflict", reason="identifier", subject_ids=(ASML_SECURITY,), candidate_ids=(),
            evidence_ids=("record:00aa",), state="open", opened_at=NOW, plugins=("reference",), scheme="lei",
            values=("724500Y6DUVHQD6OXN27", "529900VENUE0PERATR69")))
        release, rows = at.metadata(lifecycle.REKEYED), list(at.db.iterdump())
        removed = reference_package.remove(self.data)
        self.assertEqual((removed["changed"], removed["installed"]), (True, None))
        self.assertTrue(removed["removed"]["current"].startswith("reference-20260926-"))  # the record, set aside
        self.assertEqual(reference_package.remove(self.data)["changed"], False)  # nothing left to remove
        # A saved reference opens as its own stub, labelled by the device's evidence, and says why.
        body = json.loads(queue_ops.read_subject(self.ops, {"subject_id": ASML}))
        self.assertEqual(body["outcome"], "ok")
        self.assertEqual((body["data"]["subject"], body["data"]["identifiers"], body["data"]["sections"]),
                         ({"id": ASML, "level": "listing", "name": "ASML Holding NV", "kind": None, "listing": None,
                           "description": queue_ops.REMOVED}, {"figi": "BBG000C1HT47"}, []))
        self.assertEqual(body["issues"][0]["message"], queue_ops.REMOVED)
        self.assertEqual(json.loads(self.ops.reference_status({}))["issues"][0]["message"], queue_ops.REMOVED)
        unknown = json.loads(queue_ops.read_subject(self.ops, {"subject_id": "security:isin:DE0007164600"}))
        self.assertEqual((unknown["outcome"], unknown["data"]["subject"]["name"]), ("ok", "security:isin:DE0007164600"))
        self.assertEqual(self.groups("asml"), [])
        self.assertEqual(list(at.db.iterdump()), rows)  # device evidence and the open question stay
        # The same package again: the same release, so nothing re-keys and no question is retired, in this process
        # and in a new one.
        self.assertTrue(reference_package.install(self.package, self.data, trust.CONFIRM)["changed"])
        self.assertIsNone(reference_package.status(self.data)["removed"])
        for ops in (self.ops, self.identity(self.data)):
            view = json.loads(queue_ops.read_subject(ops, {"subject_id": ASML}))["data"]
            self.assertEqual((view["subject"]["name"], view["identifiers"]["isin"]), ("ASML Holding N.V.", "NL0010273215"))
            self.assertEqual(self.groups("asml", ops)[0], ASML_GROUP)
        self.assertEqual((at.metadata(lifecycle.REKEYED), [item["id"] for item in at.open_queue([ASML_SECURITY])]),
                         (release, ["build-1"]))
        self.assertEqual(list(at.db.iterdump()), rows)


if __name__ == "__main__":
    unittest.main()
