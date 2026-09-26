"""The resolution queue: reading it, settling it by rule, and agent and user verdicts under the authority rule."""
import contextvars
import importlib.util
import json
import sqlite3
import sys
import types
import unittest.mock
from pathlib import Path

from test_identity_contracts import PROVENANCE, identity
from test_identity_page import ASML, Fixture, plugin
from pythia_identity_fixture import page, queue, store  # noqa: E402

NOW, AS_OF = "2026-09-26T10:00:00Z", "2026-09-26"


def answer(*identifiers, native_id="ASML.AS"):
    record = {"level": "listing", "provenance": PROVENANCE, "attributes": {"name": "ASML Holding"},
              "identifiers": [{"scheme": scheme, "value": value} for scheme, value in identifiers],
              "native_ref": {"provider": "eodhd", "native_id": native_id, "native_scope": "catalogue"}}
    return identity.batch_from_json({"plugin": "eodhd", "provider": "eodhd", "adapter_version": "1",
                                     "origin": "resolve", "claims": [record]})


class QueueFixture(Fixture):
    def bare(self):
        """ASML as a device without its identifier evidence sees it: a resolve answer proves nothing."""
        return {**page.load_subject(self.ref, ASML), "evidence": [], "values": {}}

    def ask(self, batch, subject=None):
        """What identity-resolve does with one answer: keep the claim, then queue what the rule cannot bind."""
        eodhd = plugin("eodhd")
        subject = subject or page.load_subject(self.ref, ASML)
        for claim in identity.batch_to_json(batch)["claims"]:
            self.identity.put_claim(batch.plugin, batch.provider, claim)
        binding, item, _ = page.apply_resolve(batch, eodhd, identity.Level.LISTING, subject,
                                              page.resolve_input(eodhd, subject), now=NOW, as_of=AS_OF)
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
        agent = self.submit(item, "agent", confidence=0.99, rationale="Same ticker and name.")
        user = self.submit(item, "user", user_turn="desk:identity-verdict:test")
        self.assertEqual([agent["outcome"], user["outcome"]], ["blocked", "blocked"])
        self.assertEqual(self.identity.queue_item(item.id)["state"], "open")
        self.assertIsNone(self.identity.binding_for(item.provider_ref))
        history = queue.inspect(self.identity, self.ref, item.id)["history"]
        self.assertEqual([(entry["resolver"], entry["authority"], entry["outcome"]) for entry in history],
                         [("agent", "model_confirmed", "blocked"), ("user", "user_attested", "blocked")])

    def test_a_verdict_may_confirm_without_identifier_proof_and_leaves_an_audit_trail(self):
        item = self.ask(answer(), subject=self.bare())  # nothing proves the answer: a residual
        self.assertEqual((item.kind, item.reason, item.candidate_ids), ("residual", "no_key", (ASML,)))
        view = queue.inspect(self.identity, self.ref, item.id)
        self.assertEqual((view["record"]["name"], view["candidates"][0]["name"]), ("ASML Holding", "ASML Holding N.V."))
        self.assertIn({"relation": "same_listing", "chosen_id": ASML}, view["answers"])

        low = self.submit(item, "agent", confidence=0.5)
        self.assertEqual((low["outcome"], low["state"]), ("suggested", "open"))
        view = queue.inspect(self.identity, self.ref, item.id)  # what the agent reads before answering again
        high = self.submit(item, "agent", confidence=0.95)
        self.assertEqual((high["outcome"], high["state"], high["authority"]), ("confirmed", "resolved", "model_confirmed"))

        bound = self.identity.binding_for(item.provider_ref)
        self.assertEqual((bound["subject_id"], bound["status"], bound["verdict_id"]), (ASML, "confirmed", high["verdict_id"]))
        row = self.identity.db.execute("SELECT * FROM verdicts WHERE id = ?", (high["verdict_id"],)).fetchone()
        self.assertEqual((row["model"], row["input_digest"]), (queue.AGENT_MODEL, view["digest"]))
        self.assertEqual(self.identity.queue_item(item.id)["resolved_by"], high["verdict_id"])
        _subject, sections = self.compose(ASML, [plugin("eodhd")])
        self.assertEqual((sections["quote"]["status"], sections["quote"]["binding_status"]), ("ready", "confirmed"))
        with self.assertRaises(queue.Refused):  # a settled question takes no further verdicts
            self.submit(item, "user", user_turn="desk:identity-verdict:test")

    def test_not_a_match_dismisses_the_question_for_good(self):
        item = self.ask(answer(), subject=self.bare())
        result = self.submit(item, "user", relation="unrelated", user_turn="desk:identity-verdict:test")
        self.assertEqual((result["outcome"], result["state"]), ("no_match", "dismissed"))
        self.assertTrue(self.identity.dismissed(item.key))
        self.assertEqual(self.identity.open_queue([ASML]), [])

    def test_an_answer_outside_the_question_is_refused(self):
        item = self.ask(answer(), subject=self.bare())
        with self.assertRaises(queue.Refused):
            self.submit(item, "agent", chosen_id="listing:isin:USN070592100:XNAS:USD", confidence=0.99)
        with self.assertRaises(queue.Refused):
            self.submit(item, "agent")  # an agent states its confidence


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
        from pythia_core_queue_fixture import identity_ops
        from pythia_core_queue_fixture.platform import request_context
        builds = Path(self.tmp.name) / "builds"
        builds.mkdir()
        (builds / self.path.name).write_bytes(self.path.read_bytes())
        with sqlite3.connect(builds / self.path.name) as db:
            db.execute("INSERT INTO release (key, value) VALUES ('schema_version', ?)", (store.REFERENCE_SCHEMA_VERSION,))
        ops = identity_ops.Identity(types.SimpleNamespace(state=types.SimpleNamespace(data_dir=Path(self.tmp.name) / "core")))
        item = self.ask(answer(), subject=self.bare())
        arguments = {"item_id": item.id, "relation": "same_listing", "chosen_id": ASML, "confidence": 0.5}
        with unittest.mock.patch.dict("os.environ", {store.REFERENCE_DIR_ENV: str(builds)}), \
                unittest.mock.patch.object(identity_ops, "installed", lambda: []):
            agent = json.loads(ops.verdict(arguments))["data"]
            desk = contextvars.copy_context()
            desk.run(request_context.usage.set, "dashboard")
            user = json.loads(desk.run(ops.verdict, arguments))["data"]
            listed = json.loads(ops.queue({"subject_id": ASML}))
        ops.store.db.close()
        self.assertEqual((agent["authority"], agent["outcome"]), ("model_suggested", "suggested"))
        self.assertEqual((user["authority"], user["outcome"], user["state"]), ("user_attested", "confirmed", "resolved"))
        self.assertEqual((listed["outcome"], listed["data"]["items"]), ("empty", []))
        del core


if __name__ == "__main__":
    unittest.main()
