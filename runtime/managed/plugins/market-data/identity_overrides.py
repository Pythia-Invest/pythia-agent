"""Evidence-record-backed local mapping corrections, never connector authority."""
import json

from .identity_db import dumps, evidence_rows, identifier, subject_row
from .identity_matching import compare
from .identity_repair import apply_evaluation, evidence_current, target_records
from .wire import require, validate


def apply_override(store, mapping_id, effect, evidence_ids, target=None):
    require(effect in ("positive", "negative"), "identity", "invalid override effect")
    with store._access() as db:
        row = store._mapping(db, mapping_id)
        native = json.loads(row["native_key"])
        referenced = store._evidence(db, native, evidence_ids)
        current_ids = json.loads(row["evidence_ids"])
        require(bool(referenced) and set(evidence_ids) <= set(current_ids), "identity", "override requires current evidence records")
        require(any(item["authority"] == "source_asserted" for item in referenced), "identity", "override lacks asserted evidence")
        subject = validate("subject", target) if target else {"kind": row["scope"], "id": row["target"]}
        require(subject["kind"] == row["scope"], "identity", "override target scope differs")
        require(effect != "negative" or subject["id"] == row["target"], "identity", "negative override cannot change target")
        target_row = subject_row(db, subject["id"])
        target_evidence = target_records(db, target_row)
        evidence = evidence_rows(db, current_ids)
        proof = compare(native, evidence, json.loads(target_row["native_ref"]), target_evidence, row["scope"])
        # Referenced proof itself must suffice; the caller cannot cite an unrelated
        # name record while relying silently on other evidence in the database.
        cited_proof = compare(native, referenced, json.loads(target_row["native_ref"]), target_evidence, row["scope"])
        required_proof = "confirmed" if effect == "positive" else "conflicting"
        require(proof == cited_proof == required_proof, "identity", "override is not supported by scoped evidence")
        require(evidence_current(evidence + target_evidence, store.evidence_versions), "identity", "override evidence needs refresh")
        if row["active_override"]:
            db.execute("UPDATE overrides SET state='revoked' WHERE id=?", (row["active_override"],))
        override_id = identifier("override")
        db.execute("INSERT INTO overrides VALUES (?, ?, ?, ?, ?, ?)",
                   (override_id, mapping_id, subject["id"], effect, dumps(evidence_ids), "active"))
        db.execute("UPDATE mappings SET target=?,active_override=? WHERE id=?", (subject["id"], override_id, mapping_id))
        updated = store._mapping(db, mapping_id)
        apply_evaluation(db, updated, store.rules, store.evidence_versions)
        return store._inspect(db, mapping_id)


def revoke_override(store, override_id):
    with store._access() as db:
        override = db.execute("SELECT * FROM overrides WHERE id=?", (override_id,)).fetchone()
        require(override is not None, "identity", "unknown override")
        if override["state"] == "active":
            db.execute("UPDATE overrides SET state='revoked' WHERE id=?", (override_id,))
            db.execute("UPDATE mappings SET active_override=NULL WHERE id=?", (override["mapping_id"],))
            apply_evaluation(db, store._mapping(db, override["mapping_id"]), store.rules, store.evidence_versions)
        return store._inspect(db, override["mapping_id"])


def inspect_overrides(store, mapping_id):
    with store._access() as db:
        store._mapping(db, mapping_id)
        return [{"id": row["id"], "mapping_id": mapping_id,
                 "target": row["target"], "effect": row["effect"],
                 "evidence_ids": json.loads(row["evidence_ids"]), "state": row["state"]}
                for row in db.execute("SELECT * FROM overrides WHERE mapping_id=? ORDER BY rowid", (mapping_id,))]
