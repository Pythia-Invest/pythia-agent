"""The resolution queue: reading it, settling it by rule, and agent and user verdicts under the authority rule."""
import contextvars
import importlib.util
import json
import sqlite3
import sys
import threading
import types
import unittest
import unittest.mock
from pathlib import Path

from test_identity_contracts import PROVENANCE, identity
from test_identity_page import ASML, CONTRACTS, LEI, Fixture, plugin
from test_reference_package import make_package
from pythia_identity_fixture import build_questions, page, queue, reference_package, schemes, store  # noqa: E402

NOW, AS_OF = "2026-09-26T10:00:00Z", "2026-09-26"


def answer(*identifiers, native_id="ASML.AS", mic=None):
    record = {"level": "listing", "provenance": PROVENANCE, "attributes": {"name": "ASML Holding", "mic": mic},
              "identifiers": [{"scheme": scheme, "value": value} for scheme, value in identifiers],
              "native_ref": {"provider": "eodhd", "native_id": native_id, "native_scope": "catalogue"}}
    return identity.batch_from_json({"plugin": "eodhd", "provider": "eodhd", "adapter_version": "1",
                                     "origin": "resolve", "claims": [record]})


class QueueFixture(Fixture):
    def bare(self):
        """ASML as a device without its identifier evidence sees it: a resolve answer proves nothing."""
        return {**page.load_subject(self.ref, ASML), "evidence": [], "values": {}}

    def ask(self, batch, subject=None, eodhd=None):
        """What identity-resolve does with one answer: keep the claim, then queue what the rule cannot bind."""
        eodhd = eodhd or plugin("eodhd")
        subject = subject or page.load_subject(self.ref, ASML)
        for claim in identity.batch_to_json(batch)["claims"]:
            self.identity.put_claim(batch.plugin, batch.provider, claim)
        def bound_to(ref):
            row = self.identity.binding_for(ref)
            return row["subject_id"] if row is not None and row["status"] == "confirmed" else None

        binding, item, _ = page.apply_resolve(batch, eodhd, identity.Level.LISTING, subject,
                                              page.resolve_input(eodhd, subject), now=NOW, as_of=AS_OF, bound_to=bound_to)
        self.assertIsNone(binding)
        self.identity.put_queue_item(item)
        return item

    def submit(self, item, resolver, relation="same_listing", chosen_id=ASML, **fields):
        return queue.submit(self.identity, self.ref, item_id=item.id, resolver=resolver, relation=relation,
                            chosen_id=chosen_id, now=NOW, as_of=AS_OF, **fields)


class VerdictTest(QueueFixture):
    def test_no_verdict_confirms_against_identifier_proof(self):
        item = self.ask(answer(("isin", "USN070592100")))  # EODHD's record names the NASDAQ receipt's ISIN
        self.assertEqual(item.kind, "conflict")
        agent = self.submit(item, "agent", rationale="Same ticker and name.")
        user = self.submit(item, "user", user_turn="desk:identity-verdict:test")
        self.assertEqual([agent["outcome"], user["outcome"]], ["blocked", "blocked"])
        self.assertEqual(self.identity.queue_item(item.id)["state"], "open")
        self.assertIsNone(self.identity.binding_for(item.provider_ref))
        history = queue.inspect(self.identity, self.ref, item.id)["history"]
        self.assertEqual([(entry["resolver"], entry["authority"], entry["outcome"]) for entry in history],
                         [("agent", "agent_confirmed", "blocked"), ("user", "user_attested", "blocked")])

    def test_no_answer_dismisses_against_identifier_proof(self):
        nasdaq = "listing:isin:USN070592100:XNAS:USD"
        ref = {"provider": "eodhd", "native_id": "ASML.AS", "native_scope": "catalogue"}
        self.identity.put_binding(identity.Binding(provider_ref=ref, subject_id=nasdaq, status="confirmed",
                                                   authority="user_attested", evidence_ids=["ev:x"], plugin="eodhd"))
        # ASML's ISIN answering for the XAMS listing (no venue stated), but the reference is bound elsewhere.
        item = self.ask(answer(("isin", "NL0010273215")))
        self.assertEqual((item.kind, item.reason, set(item.subject_ids)), ("conflict", "binding", {nasdaq, ASML}))
        # The listing names the instrument the record is bound to, not only the candidate.
        view = queue.summary(self.identity, self.ref, self.identity.queue_item(item.id))
        self.assertEqual({subject["id"] for subject in view["subjects"]}, {nasdaq, ASML})
        self.assertIsNone(view["agent_answer"])
        for resolver, fields in (("agent", {}), ("user", {"user_turn": "desk:identity-verdict:test"})):
            result = self.submit(item, resolver, relation="unrelated", **fields)
            self.assertEqual((result["outcome"], result["state"]), ("blocked", "open"))
            self.assertIn("names this instrument", result["message"])
        self.assertFalse(self.identity.dismissed(item.key, item.evidence_ids))

    def test_evidence_above_the_questions_level_does_not_block_not_a_match(self):
        # Only the issuer's LEI, or the ISIN without this venue: the record may be another line of the same company.
        for identifiers, mic in (((("lei", LEI),), None), ((("isin", "NL0010273215"),), "XNAS")):
            item = self.ask(answer(*identifiers, native_id=f"ASML.{mic}", mic=mic), subject=self.bare())
            result = self.submit(item, "user", relation="unrelated", user_turn="desk:identity-verdict:test")
            self.assertEqual((result["outcome"], result["state"]), ("no_match", "dismissed"))

    def test_the_agents_answer_changes_nothing_until_the_user_confirms_it(self):
        item = self.ask(answer(), subject=self.bare())  # nothing proves the answer: a residual
        self.assertEqual((item.kind, item.reason, item.candidate_ids), ("residual", "no_key", (ASML,)))
        view = queue.inspect(self.identity, self.ref, item.id)
        self.assertEqual((view["record"]["name"], view["candidates"][0]["name"]), ("ASML Holding", "ASML Holding N.V."))
        self.assertIn({"relation": "same_listing", "chosen_id": ASML}, view["answers"])

        # ADR 0044 ruling 8: the agent proposes. Its answer is recorded; the question stays open and nothing routes.
        agent = self.submit(item, "agent")
        self.assertEqual((agent["outcome"], agent["state"], agent["authority"]), ("suggested", "open", "agent_confirmed"))
        self.assertIsNone(self.identity.binding_for(item.provider_ref))
        row = self.identity.db.execute("SELECT * FROM verdicts WHERE id = ?", (agent["verdict_id"],)).fetchone()
        self.assertEqual((row["model"], row["input_digest"], row["confidence"]), (queue.AGENT_MODEL, view["digest"], None))
        _subject, sections = self.compose(ASML, [plugin("eodhd")])
        self.assertNotEqual(sections["quote"]["binding_status"], "confirmed")
        no = self.submit(item, "agent", relation="none", chosen_id=None)  # a "not a match" dismisses nothing either
        self.assertEqual((no["outcome"], self.identity.queue_item(item.id)["state"]), ("suggested", "open"))

        # The user answers, overriding the agent's latest suggestion ("none"); only then is the record bound.
        [listed] = [queue.summary(self.identity, self.ref, entry) for entry in self.identity.queue_items(subject_ids=[ASML])]
        self.assertEqual(listed["agent_answer"], {"by": "agent", "relation": "none", "chosen_id": None})
        user = self.submit(item, "user", user_turn="desk:identity-verdict:test")
        self.assertEqual((user["outcome"], user["state"], user["authority"]), ("confirmed", "resolved", "user_attested"))
        bound = self.identity.binding_for(item.provider_ref)
        self.assertEqual((bound["subject_id"], bound["authority"]), (ASML, "user_attested"))
        _subject, sections = self.compose(ASML, [plugin("eodhd")])
        self.assertEqual((sections["quote"]["status"], sections["quote"]["binding_status"]), ("ready", "confirmed"))
        history = queue.inspect(self.identity, self.ref, item.id)["history"]
        self.assertEqual([(entry["resolver"], entry["outcome"]) for entry in history],
                         [("agent", "suggested"), ("agent", "suggested"), ("user", "confirmed")])

    def test_not_a_match_dismisses_the_question_for_good(self):
        item = self.ask(answer(), subject=self.bare())
        result = self.submit(item, "user", relation="unrelated", user_turn="desk:identity-verdict:test")
        self.assertEqual((result["outcome"], result["state"]), ("no_match", "dismissed"))
        self.assertTrue(self.identity.dismissed(item.key, item.evidence_ids))
        self.assertFalse(self.identity.dismissed(item.key, ("ev:new-reference-evidence",)))  # new proof reopens it
        self.assertEqual(self.identity.open_queue([ASML]), [])

    def test_an_answer_outside_the_question_is_refused(self):
        item = self.ask(answer(), subject=self.bare())
        with self.assertRaises(queue.Refused):
            self.submit(item, "agent", chosen_id="listing:isin:USN070592100:XNAS:USD")

    def test_a_question_without_a_provider_record_takes_no_answer(self):
        item = identity.QueueItem(id="q-identifier", kind="conflict", reason="identifier", subject_ids=(ASML,),
                                  candidate_ids=(ASML,), evidence_ids=("ev:x",), state="open", opened_at=NOW,
                                  plugins=("eodhd",), scheme="isin", values=("NL0010273215", "USN070592100"))
        self.identity.put_queue_item(item)
        with self.assertRaises(queue.Refused):
            self.submit(item, "user", user_turn="desk:identity-verdict:test")
        self.assertEqual(self.identity.queue_item(item.id)["state"], "open")


class BuildQuestionTest(QueueFixture):
    def test_an_open_reference_build_row_is_superseded_on_the_next_release(self):
        # Build questions are curation questions (ADR 0044): an earlier core may have queued some; they leave Repairs.
        security = page.load_subject(self.ref, ASML)["ids"]["security"]
        self.identity.put_queue_item(identity.QueueItem(
            id="ref-old", kind="residual", reason="ambiguous", subject_ids=(security,), candidate_ids=(ASML,),
            evidence_ids=(), state="open", opened_at=NOW, plugins=(queue.BUILD,)))
        self.assertEqual(queue.retire_build(self.identity, NOW), 1)
        self.assertEqual(self.identity.queue_item("ref-old")["state"], "superseded")


class TitleTest(unittest.TestCase):
    """Repairs shows core's title as it is, so each kind of identifier conflict is titled in words a person reads."""

    # One subject per level a conflict can be about, and what its question is titled.
    ISSUER, SECURITY = "issuer:lei:724500Y6DUVHQD6OXN27", "security:isin:NL0010273215"
    COMPOSITE, LISTING = "composite:figi:BBG000BLNNH6", "listing:figi:BBG000B9XRY4"
    TITLES = {"lei": (ISSUER, "Which LEI?"), "cik": (ISSUER, "Which CIK?"), "isin": (SECURITY, "Which ISIN?"),
              "share_class_figi": (SECURITY, "Which Share-class FIGI?"),
              "composite_figi": (COMPOSITE, "Which Composite FIGI?"), "figi": (LISTING, "Which FIGI?"),
              "caip19": (LISTING, "Which CAIP-19?")}

    def conflict(self, scheme, subject):
        return {"kind": "conflict", "reason": "identifier", "scheme": scheme, "subject_ids": [subject],
                "plugins": [build_questions.BUILD], "provider_ref": None}

    def test_every_contestable_identifier_has_a_title_in_words(self):
        contestable = {str(scheme) for scheme in schemes.SINGLE_VALUED if scheme in schemes.SCHEME_LEVEL}
        self.assertEqual(set(self.TITLES), contestable, "a new contestable scheme needs its title here")
        for scheme, (subject, expected) in self.TITLES.items():
            with self.subTest(scheme=scheme):
                self.assertEqual(queue.title(self.conflict(scheme, subject)), expected)

    def test_the_question_names_the_identifier_in_the_same_words(self):
        asked = build_questions.asked({**self.conflict("share_class_figi", self.SECURITY), "candidate_ids": [],
                                       "values": ["BBG001S5N8V8", "BBG001S5PQL7"]})[0]
        self.assertTrue(asked.startswith("Which Share-class FIGI is this? Its sources name Share-class FIGI BBG001S5N8V8, "))

    def test_every_scheme_has_a_label_and_one_core_does_not_know_shows_as_itself(self):
        self.assertEqual(set(schemes.SCHEME_LABEL), set(schemes.Scheme))
        self.assertEqual((schemes.scheme_label("a_future_scheme"), schemes.scheme_label(None)), ("a future scheme", ""))


class StoreTest(QueueFixture):
    def test_a_rolled_back_transaction_never_drops_another_threads_write(self):
        writer = threading.Thread(target=self.identity.put_miss, args=(ASML, "pythia-eodhd", "EODHD found no match", 60))
        with self.assertRaises(RuntimeError):
            with self.identity.transaction():
                writer.start()
                writer.join(timeout=0.2)
                self.assertTrue(writer.is_alive())  # it waits for the transaction instead of joining it
                raise RuntimeError("roll back")
        writer.join(timeout=5)
        self.assertEqual(self.identity.misses(ASML), {"pythia-eodhd": "EODHD found no match"})


    def test_an_older_store_is_kept_aside_with_a_warning_and_reported_once(self):
        directory = Path(self.tmp.name) / "older"
        directory.mkdir()
        with sqlite3.connect(directory / "identity.sqlite3") as db:
            db.executescript("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                             "INSERT INTO metadata VALUES ('schema_version', '2');")
        (directory / "identity.sqlite3-journal").write_bytes(b"")  # a leftover (empty) rollback journal
        with self.assertLogs(store.logger, "WARNING"):
            fresh = store.IdentityStore(directory)
        [kept] = directory.glob("identity.v2-*.sqlite3")
        self.assertTrue(kept.with_name(kept.name + "-journal").exists())
        self.assertEqual((fresh.set_aside, fresh.metadata("schema_version")), (kept.name, store.SCHEMA_VERSION))
        told = queue.listing(fresh, self.ref, subject_id=None, kind=None, plugins=None, limit=20, notice=True)
        self.assertIn(kept.name, told["notice"])
        fresh.db.close()


class RulesTest(QueueFixture):
    def test_new_identifier_proof_settles_an_item_and_contradictions_stay_open(self):
        # Asked while the device had no ISIN evidence for ASML: the ISIN proves nothing yet.
        residual = self.ask(answer(("isin", "NL0010273215")), subject=self.bare())
        conflict = self.ask(answer(("isin", "USN070592100"), native_id="ASML.XX"))
        self.assertEqual((residual.kind, conflict.kind), ("residual", "conflict"))

        items = self.identity.queue_items(subject_ids=[ASML])
        settled = queue.settle_by_rules(self.identity, self.ref, [plugin("eodhd")], items, now=NOW, as_of=AS_OF)
        self.assertEqual(settled, [residual.id])
        self.assertEqual([item["id"] for item in self.identity.queue_items(subject_ids=[ASML])], [conflict.id])
        bound = self.identity.binding_for(residual.provider_ref)
        self.assertEqual((bound["subject_id"], bound["authority"], bound["rule_id"]), (ASML, "rule_confirmed", "resolve_answer@1"))
        [entry] = queue.inspect(self.identity, self.ref, residual.id)["history"]
        self.assertEqual((entry["resolver"], entry["outcome"]), ("rules", "confirmed"))

    def test_an_unreadable_stored_claim_is_logged_by_its_item_and_the_rest_still_settle(self):
        broken = self.ask(answer(("isin", "NL0010273215"), native_id="ASML.BROKEN"), subject=self.bare())
        residual = self.ask(answer(("isin", "NL0010273215")), subject=self.bare())
        with self.identity.transaction():  # a damaged row, or one a later version wrote
            self.identity.db.execute("UPDATE claims SET claim = ? WHERE native_id = 'ASML.BROKEN'",
                                     (json.dumps({"level": "listing", "attributes": {"name": "Private Holdings"}}),))
        items = self.identity.queue_items(subject_ids=[ASML])
        with self.assertLogs(queue.logger, "WARNING") as logged:
            settled = queue.settle_by_rules(self.identity, self.ref, [plugin("eodhd")], items, now=NOW, as_of=AS_OF)
        self.assertEqual(settled, [residual.id])
        [line] = logged.output
        self.assertIn(broken.id, line)
        self.assertNotIn("Private Holdings", line)  # the item is named, never what the claim holds
        self.assertNotIn("ASML.BROKEN", line)

    def test_rules_skip_a_disabled_plugin(self):
        self.ask(answer(("isin", "NL0010273215")), subject=self.bare())
        items = self.identity.queue_items()
        self.assertEqual(queue.settle_by_rules(self.identity, self.ref, [plugin("eodhd", enabled=False)], items,
                                               now=NOW, as_of=AS_OF), [])


CORE = Path(__file__).parents[2] / "managed/core/__init__.py"


def load_core():
    spec = importlib.util.spec_from_file_location("pythia_core_queue_fixture", CORE,
                                                  submodule_search_locations=[str(CORE.parent)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class TransportTest(QueueFixture):
    """The transport decides who answers: a model tool call is the agent, the Desk's HTTP call the user."""

    def test_only_the_desk_transport_attests(self):
        core = load_core()
        from pythia_core_queue_fixture import identity_ops, queue_ops
        from pythia_core_queue_fixture.platform import request_context
        reference_package.install(make_package(Path(self.tmp.name) / "out", source=self.path), Path(self.tmp.name) / "core")
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=Path(self.tmp.name) / "core")
        item = self.ask(answer(), subject=self.bare())
        arguments = {"item_id": item.id, "relation": "same_listing", "chosen_id": ASML}
        with unittest.mock.patch.object(identity_ops, "installed", lambda: []):
            agent = json.loads(queue_ops.submit_verdict(ops, arguments))["data"]
            waiting_body = json.loads(queue_ops.read_queue(ops, {"subject_id": ASML}))
            waiting, waiting_outcome = waiting_body["data"], waiting_body["outcome"]
            desk = contextvars.copy_context()
            desk.run(request_context.usage.set, "dashboard")
            user = json.loads(desk.run(queue_ops.submit_verdict, ops, arguments))["data"]
            listed = json.loads(queue_ops.read_queue(ops, {"subject_id": ASML}))
        ops.store.db.close()
        self.assertEqual((agent["authority"], agent["outcome"]), ("agent_confirmed", "suggested"))
        self.assertEqual(([row["id"] for row in waiting["items"]], waiting["items"][0]["agent_answer"]["relation"]),
                         ([item.id], "same_listing"))
        self.assertEqual(waiting_outcome, "ok")
        self.assertEqual((user["authority"], user["outcome"], user["state"]), ("user_attested", "confirmed", "resolved"))
        self.assertEqual((listed["outcome"], listed["data"]["items"]), ("empty", []))
        del core


class SubjectOperationTest(QueueFixture):
    def test_price_sources_name_the_providers_the_investor_put_in_source_order(self):
        core = load_core()
        from pythia_core_queue_fixture import identity_ops
        reference_package.install(make_package(Path(self.tmp.name) / "out", source=self.path), Path(self.tmp.name) / "core")
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=Path(self.tmp.name) / "core")
        with unittest.mock.patch.object(identity_ops, "installed", lambda: [plugin("yahoo"), plugin("eodhd")]), \
                unittest.mock.patch.object(identity_ops.Identity, "order", lambda _self, _plugins=None: ("pythia-eodhd", "unknown")):
            routed = ops.price_sources(ASML)
        ops.store.db.close()
        del core
        self.assertEqual((routed["reason"], routed["named"]), (None, ["eodhd"]))  # an unknown name names no provider

    def test_a_miss_answers_the_section_as_the_next_source_now_serves_it(self):
        """ADR 0040 hand-over: EODHD finds nothing, so its quote section is led by the next source, still to look up."""
        core = load_core()
        from pythia_core_queue_fixture import identity_ops
        reference_package.install(make_package(Path(self.tmp.name) / "out", source=self.path), Path(self.tmp.name) / "core")
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=Path(self.tmp.name) / "core")
        mirror = {**CONTRACTS["eodhd"], "plugin": "mirror", "provider": "mirror",
                  "addressing": {**CONTRACTS["eodhd"]["addressing"],
                                 "native": [{"native_scope": "catalogue", "level": "listing", "asset_classes": ["equity"]}]}}
        plugins = [plugin("eodhd"), page.PluginInfo(key="pythia-mirror", manifest=identity.validate_manifest(mirror))]
        with unittest.mock.patch.object(identity_ops, "installed", lambda: plugins), \
                unittest.mock.patch.object(ops, "_resolve", lambda *_: ("EODHD found no match", False)):
            before = {s["section"]: s for s in json.loads(ops.subject({"subject_id": ASML}))["data"]["sections"]}
            answer = json.loads(ops.resolve({"subject_id": ASML, "plugin": "pythia-eodhd"}))["data"]["sections"]
        ops.store.db.close()
        del core
        self.assertEqual((before["quote"]["plugin"], before["quote"]["status"]), ("pythia-eodhd", "resolving"))
        [quote] = answer
        self.assertEqual((quote["plugin"], quote["status"]), ("pythia-mirror", "resolving"))
        self.assertEqual([(item["plugin"], item["reason"]) for item in quote["skipped"]],
                         [("pythia-eodhd", "EODHD found no match")])

    def test_a_miss_reaches_the_issuers_filings_and_every_view_of_the_company(self):
        """An EU issuer without a CIK: SEC's lookup, run at the instrument (the page route), finds nothing. The
        issuer's filings read and a listing's view see that miss: nothing waits on a lookup that ran."""
        from test_selection import FilingsMergeTest, shipped
        with sqlite3.connect(self.path) as db:
            db.execute("DELETE FROM assertions WHERE scheme = 'cik'")
        core = load_core()
        from pythia_core_queue_fixture import concept_ops, identity_ops
        reference_package.install(make_package(Path(self.tmp.name) / "out", source=self.path), Path(self.tmp.name) / "core")
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=Path(self.tmp.name) / "core")
        reads = concept_ops.ConceptReads(ops)
        reads.eligible = lambda: None
        registry = types.SimpleNamespace(dispatch=lambda *_a, **_k: json.dumps(FilingsMergeTest().xbrl()),
                                         get_schema=lambda _tool: None)
        security, nasdaq = "security:isin:NL0010273215", "listing:figi:BBG000K6N6G7"

        def filings(subject_id):
            view = json.loads(ops.subject({"subject_id": subject_id}))["data"]
            section = next(item for item in view["sections"] if item["section"] == "filings")
            return {item["plugin"]: item["code"] for item in section["skipped"]}, section["request"]
        with unittest.mock.patch.object(identity_ops, "installed", shipped), \
                unittest.mock.patch.object(ops, "_resolve", lambda *_: ("SEC EDGAR found no match", False)), \
                unittest.mock.patch.dict("sys.modules", {"tools": types.ModuleType("tools"),
                                                         "tools.registry": types.SimpleNamespace(registry=registry)}):
            self.assertEqual(filings(security)[0]["pythia-sec"], "resolving")
            ops.resolve({"subject_id": security, "plugin": "pythia-sec"})
            views = {subject: filings(subject) for subject in (security, ASML, nasdaq)}
            body = json.loads(reads.filings(views[nasdaq][1]["arguments"]))
        ops.store.db.close()
        del core
        self.assertEqual({subject: skipped["pythia-sec"] for subject, (skipped, _) in views.items()},
                         dict.fromkeys(views, "unresolved"))
        self.assertEqual((body["outcome"], body["data"]["partial"]), ("ok", False))
        self.assertEqual(next(item["reason"] for item in body["data"]["skipped"] if item["plugin"] == "pythia-sec"),
                         "SEC EDGAR found no match")

    def test_a_share_class_is_listed_once_under_other_securities_not_related(self):
        core = load_core()
        from pythia_core_queue_fixture import identity_ops
        path = Path(self.tmp.name) / "fixture.sqlite3"
        path.write_bytes(self.path.read_bytes())
        other = "security:isin:NL0000000C07"
        with sqlite3.connect(path) as db:
            db.execute("INSERT INTO securities (id, issuer_id, name, asset_class, kind) VALUES (?, ?, 'ASML class C',"
                       " 'equity', 'ordinary')", (other, f"issuer:lei:{LEI}"))
            db.execute("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency) VALUES"
                       " ('listing:isin:NL0000000C07:XAMS:EUR', ?, 'XAMS', 'XAMS', 'ASMLC', 'EUR')", (other,))
            db.execute("INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin, adapter_version,"
                       " retrieved_at) VALUES ('ev:class', 'share_class_of', ?, 'security:isin:NL0010273215', 'source_asserted',"
                       " 'fixture', 'pythia', '1', '2026-09-28T00:00:00Z')", (other,))
        reference_package.install(make_package(Path(self.tmp.name) / "out", source=path), Path(self.tmp.name) / "core")
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=Path(self.tmp.name) / "core")
        with unittest.mock.patch.object(identity_ops, "installed", lambda: []):
            view = json.loads(ops.subject({"subject_id": ASML}))["data"]
            status = json.loads(ops.reference_status({}))
        ops.store.db.close()
        self.assertEqual([(item["id"], item["ticker"]) for item in view["other_securities"]], [(other, "ASMLC")])
        self.assertEqual(view["related"], [])
        self.assertEqual((status["outcome"], status["data"]["installed"]["build_id"]), ("ok", "reference-20260926"))
        del core


if __name__ == "__main__":
    unittest.main()
