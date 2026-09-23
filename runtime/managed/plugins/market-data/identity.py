"""Canonical identity persistence, explicitly separate from provider execution.

Construct with ctx.state.data_dir. ingest() is an internal connector boundary;
public mutations take already-ingested evidence IDs, never evidence assertions.
All accesses repair affected associations before returning routable bindings.
"""
from contextlib import contextmanager
import json

from .identity_db import (IdentityDatabase, dumps, evidence_rows, generation, identifier,
                          native_key, record_revision, subject_row)
from .identity_matching import EquityRules, compare, rule_for, valid_isin
from .identity_repair import apply_evaluation, dependencies, evidence_current, repair, repair_candidate, target_records
from .wire import validate, require


class IdentityStore:
    def __init__(self, data_dir, *, rules=None, evidence_versions=None):
        self.database = IdentityDatabase(data_dir)
        self.rules = rules or EquityRules()
        # Only installed adapter evidence revisions, not a model-supplied option.
        self.evidence_versions = dict(evidence_versions or {})

    @contextmanager
    def _access(self):
        with self.database.transaction() as db:
            repair(db, self.rules, self.evidence_versions)
            yield db

    def ingest(self, native_ref, evidence):
        """Internal trusted adapter ingestion; never expose evidence as model args.

        This records normalized connector observations only. Search must not call
        this automatically; an authorized resolve/details operation owns ingestion.
        IDs are immutable and every assertion is bound to this exact native ref.
        """
        native = validate("provider_ref", native_ref)
        require(type(evidence) is list and len(evidence) <= 100, "identity", "invalid evidence batch")
        normalized = [validate("evidence", item) for item in evidence]
        for item in normalized:
            require(item["provider_ref"] == native, "identity", "evidence native reference differs")
            if item["scheme"] == "isin" and item["authority"] == "source_asserted":
                require(valid_isin(item["value"]), "identity", "invalid asserted ISIN")
        with self._access() as db:
            for item in normalized:
                old = db.execute("SELECT data FROM evidence WHERE id=?", (item["id"],)).fetchone()
                require(old is None or old[0] == dumps(item), "identity", "evidence record is immutable")
                db.execute("INSERT OR IGNORE INTO evidence VALUES (?, ?, ?)", (item["id"], native_key(native), dumps(item)))
        return [item["id"] for item in normalized]

    def _evidence(self, db, native, ids):
        require(type(ids) is list and len(ids) <= 100 and all(type(item) is str for item in ids), "identity", "invalid evidence references")
        rows = evidence_rows(db, ids)
        require(all(item["provider_ref"] == native for item in rows), "identity", "evidence is for another native reference")
        return rows

    def save(self, native_ref, scope, evidence_ids, *, retain_reference_evidence=False):
        """Explicit local identity mutation for a user-selected native reference."""
        native = validate("provider_ref", native_ref)
        require(scope in ("company", "instrument", "listing", "crypto"), "identity", "invalid subject scope")
        require(not (native["provider"] in ("ibkr", "eodhd") and scope in ("company", "crypto")), "identity", "Equity evidence does not identify this subject scope")
        with self._access() as db:
            evidence = self._evidence(db, native, evidence_ids)
            existing = db.execute("SELECT * FROM mappings WHERE native_key=? AND scope=?", (native_key(native), scope)).fetchone()
            if existing:
                if retain_reference_evidence:
                    previous = evidence_rows(db, json.loads(existing["evidence_ids"]))
                    # Ordinary adoption refreshes source details, but deliberately
                    # does not re-run reference qualification. Keep that separate
                    # proof only while its source assertions are unchanged. IDs
                    # and observation times identify reads, not financial facts.
                    def assertions(records):
                        return {dumps({key: value for key, value in record.items()
                                      if key not in ("id", "observed_at", "retrieved_at")})
                                for record in records if not record.get("identifier_context")}
                    if (not any(record.get("identifier_context") for record in evidence)
                            and assertions(evidence) == assertions(previous)):
                        evidence_ids = [*evidence_ids, *(record["id"] for record in previous
                                                       if record.get("identifier_context"))]
                if json.loads(existing["evidence_ids"]) != evidence_ids:
                    return self._refresh(db, existing, evidence_ids)
                return self._inspect(db, existing["id"])
            matches = []
            for subject in db.execute("""SELECT * FROM subjects WHERE kind=? AND EXISTS
                    (SELECT 1 FROM mappings WHERE target=subjects.id AND status='confirmed')""", (scope,)):
                target_evidence = target_records(db, subject)
                if evidence_current(evidence + target_evidence, self.evidence_versions) and self.rules.evaluate(native, evidence, json.loads(subject["native_ref"]), target_evidence, scope) == "confirmed":
                    matches.append(subject["id"])
            if len(matches) == 1:
                subject_id = matches[0]
            else:
                subject_id = identifier(scope)
                db.execute("INSERT INTO subjects VALUES (?, ?, ?, ?)", (subject_id, scope, dumps(native), dumps(evidence_ids)))
            mapping_id = identifier("mapping")
            rule = rule_for(native, scope, evidence)
            db.execute("INSERT INTO mappings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (mapping_id, native_key(native), scope, subject_id, subject_id, dumps(evidence_ids), rule,
                        self.rules.versions.get(rule), dumps(dependencies(native, evidence, self.rules, self.evidence_versions, target_records(db, subject_row(db, subject_id)),
                                                       json.loads(subject_row(db, subject_id)["native_ref"]), scope)),
                        "candidate", "unresolved", 0, None))
            row = db.execute("SELECT * FROM mappings WHERE id=?", (mapping_id,)).fetchone()
            apply_evaluation(db, row, self.rules, self.evidence_versions)
            if len(matches) > 1:
                self._quarantine(db, mapping_id, "ambiguous_existing_subjects")
            return self._inspect(db, mapping_id)

    def _quarantine(self, db, mapping_id, reason):
        db.execute("UPDATE mappings SET status='conflicting',reason=?,revision=revision+1 WHERE id=?", (reason, mapping_id))
        record_revision(db, mapping_id)

    def _refresh(self, db, row, evidence_ids):
        # Preserve original subject intent; refreshed evidence cannot redirect it.
        db.execute("UPDATE mappings SET evidence_ids=? WHERE id=?", (dumps(evidence_ids), row["id"]))
        fresh = db.execute("SELECT * FROM mappings WHERE id=?", (row["id"],)).fetchone()
        fresh = repair_candidate(db, fresh, self.rules, self.evidence_versions)
        apply_evaluation(db, fresh, self.rules, self.evidence_versions, retire_overrides=True)
        return self._inspect(db, row["id"])

    def refresh(self, mapping_id, evidence_ids):
        """Use newly ingested evidence after an explicit connector details read."""
        with self._access() as db:
            row = self._mapping(db, mapping_id)
            self._evidence(db, json.loads(row["native_key"]), evidence_ids)
            return self._refresh(db, row, evidence_ids)

    def _mapping(self, db, mapping_id):
        row = db.execute("SELECT * FROM mappings WHERE id=?", (mapping_id,)).fetchone()
        require(row is not None, "identity", "unknown mapping")
        return row

    def _inspect(self, db, mapping_id):
        row = self._mapping(db, mapping_id)
        current = db.execute("SELECT data FROM revisions WHERE mapping_id=? AND revision=?", (mapping_id, row["revision"])).fetchone()
        return {"mapping": json.loads(current[0]), "generation": generation(db),
                "evidence": evidence_rows(db, json.loads(row["evidence_ids"])),
                "repair": row["reason"], "native_ref": json.loads(row["native_key"]),
                "intent_subject": {"kind": row["scope"], "id": row["intent_subject"]}}

    def inspect(self, mapping_id):
        with self._access() as db:
            return self._inspect(db, mapping_id)

    def history(self, mapping_id):
        with self._access() as db:
            self._mapping(db, mapping_id)
            return [json.loads(row[0]) for row in db.execute("SELECT data FROM revisions WHERE mapping_id=? ORDER BY revision", (mapping_id,))]

    def subject(self, subject):
        value = validate("subject", subject)
        with self._access() as db:
            row = subject_row(db, value["id"])
            require(row["kind"] == value["kind"], "identity", "subject scope differs")
            return {"subject": value, "original_native_ref": json.loads(row["native_ref"]),
                    "original_evidence_ids": json.loads(row["evidence_ids"])}

    def bindings(self, subject):
        """Current proven associations only; native availability is checked later."""
        value = validate("subject", subject)
        with self._access() as db:
            if db.execute("SELECT 1 FROM subjects WHERE id=? AND kind=?", (value["id"], value["kind"])).fetchone() is None:
                return {"generation": generation(db), "mappings": []}
            original = subject_row(db, value["id"])
            original_native = json.loads(original["native_ref"])
            original_evidence = evidence_rows(db, json.loads(original["evidence_ids"]))
            mappings = []
            for row in db.execute("SELECT * FROM mappings WHERE (target=? OR intent_subject=?) AND scope=? AND status='confirmed'", (value["id"], value["id"], value["kind"])):
                if row["target"] != value["id"]:
                    # Correction lineage is not routing authority for retained
                    # intent. Prove equivalence to its immutable original facts,
                    # not merely to the newly selected correction target.
                    native = json.loads(row["native_key"])
                    records = evidence_rows(db, json.loads(row["evidence_ids"]))
                    current_original = target_records(db, original)
                    if (not evidence_current(records + current_original, self.evidence_versions)
                            or compare(native, records, original_native, current_original, value["kind"]) != "confirmed"
                            or compare(native, records, original_native, original_evidence, value["kind"]) != "confirmed"):
                        continue
                mappings.append(self._inspect(db, row["id"])["mapping"])
            return {"generation": generation(db), "mappings": mappings}

    def cache_token(self):
        with self._access() as db:
            return generation(db)

    @contextmanager
    def current_generation(self, token):
        """T09 cache publication guard: hold transaction through the cache insert.

        Raises for an in-flight read from an old generation. A later cache lookup
        still needs current generation/native availability checks.
        """
        with self._access() as db:
            require(type(token) is int and token == generation(db), "identity", "stale mapping generation")
            yield token

    def repair_status(self):
        with self._access() as db:
            return {"generation": generation(db), "pending": [self._inspect(db, row["id"])["mapping"]
                    for row in db.execute("SELECT id FROM mappings WHERE status!='confirmed'")]}

    def apply_override(self, mapping_id, effect, evidence_ids, target=None):
        from .identity_overrides import apply_override
        return apply_override(self, mapping_id, effect, evidence_ids, target)

    def revoke_override(self, override_id):
        from .identity_overrides import revoke_override
        return revoke_override(self, override_id)

    def overrides(self, mapping_id):
        from .identity_overrides import inspect_overrides
        return inspect_overrides(self, mapping_id)
