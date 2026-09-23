"""Access-time repair of supported equity associations, in the caller's transaction."""
import json

from .identity_db import dumps, evidence_rows, record_revision, subject_row
from .identity_matching import compare, pair_rule, rule_for


def evidence_current(records, expected_versions):
    return all(expected_versions.get(e["provider_ref"]["provider"]) in (None, e["adapter_version"])
               and (not e.get('identifier_context') or expected_versions.get(e['identifier_context']['authority'])
                    in (None, e['identifier_context']['adapter_version']))
               for e in records)


def dependencies(native, evidence, rules, expected_versions, target_records=(), target_native=None, scope=None):
    provider = native["provider"]
    # Preserve existing single-provider dependencies/revisions unchanged.
    result = {"observed": sorted({e["adapter_version"] for e in evidence}),
              "expected": expected_versions.get(provider),
              "target_evidence_ids": sorted(e["id"] for e in target_records)}
    reference_contexts = [row['identifier_context'] for row in [*evidence, *target_records] if row.get('identifier_context')]
    if reference_contexts:
        result['reference_data'] = {authority: {
            'observed': sorted({row['adapter_version'] for row in reference_contexts if row['authority'] == authority}),
            'expected': expected_versions.get(authority)} for authority in sorted({row['authority'] for row in reference_contexts})}
    providers = {provider, *(e["provider_ref"]["provider"] for e in target_records)}
    if target_native is not None:
        providers.add(target_native["provider"])
    if len(providers) > 1:
        result["providers"] = {owner: {
            "observed": sorted({e["adapter_version"] for e in [*evidence, *target_records]
                                if e["provider_ref"]["provider"] == owner}),
            "expected": expected_versions.get(owner)} for owner in sorted(providers)}
    pair = pair_rule(native, target_native, scope)
    if pair:
        result["pair_rule"] = {"id": pair, "version": rules.versions.get(pair)}
    return result


def target_records(db, subject):
    """Current proof plus retained contradictions; original intent stays immutable."""
    original = evidence_rows(db, json.loads(subject["evidence_ids"]))
    row = db.execute("SELECT evidence_ids FROM mappings WHERE native_key=? AND scope=?",
                     (subject["native_ref"], subject["kind"])).fetchone()
    if row is None:
        return original
    current = evidence_rows(db, json.loads(row[0]))
    native = json.loads(subject["native_ref"])
    if compare(native, current, native, original, subject["kind"]) == "conflicting":
        return current + [e for e in original if e["id"] not in {item["id"] for item in current}]
    return current


def evaluate(db, row, rules, expected_versions):
    native = json.loads(row["native_key"])
    evidence = evidence_rows(db, json.loads(row["evidence_ids"]))
    target = subject_row(db, row["target"])
    target_evidence = target_records(db, target)
    target_native = json.loads(target["native_ref"])
    rule = rule_for(native, row["scope"], evidence)
    versions = dependencies(native, evidence, rules, expected_versions, target_evidence, target_native, row["scope"])
    proof = compare(native, evidence, target_native, target_evidence, row["scope"])
    if row["reason"] == "ambiguous_existing_subjects":
        status, reason = "conflicting", "ambiguous_existing_subjects"
    elif not evidence_current(evidence + target_evidence, expected_versions):
        status, reason = "candidate", "pending_evidence_refresh"
    elif proof == "conflicting":
        status, reason = "conflicting", "contradictory_evidence"
    elif rule is None:
        status, reason = "candidate", "unqualified_source_or_scope"
    else:
        status = rules.evaluate(native, evidence, target_native, target_evidence, row["scope"])
        reason = {"confirmed": "supported_evidence", "conflicting": "contradictory_evidence", "candidate": "insufficient_evidence"}[status]
    return status, reason, rule, rules.versions.get(rule), versions


def apply_evaluation(db, row, rules, expected_versions, *, retire_overrides=False):
    status, reason, rule, version, evidence_versions = evaluate(db, row, rules, expected_versions)
    override_id = row["active_override"]
    if override_id:
        override = db.execute("SELECT * FROM overrides WHERE id=?", (override_id,)).fetchone()
        native = json.loads(row["native_key"])
        target = subject_row(db, row["target"])
        target_native = json.loads(target["native_ref"])
        target_evidence = target_records(db, target)
        evidence = evidence_rows(db, json.loads(row["evidence_ids"]))
        proof = compare(native, evidence, target_native, target_evidence, row["scope"])
        if reason == "pending_evidence_refresh":
            db.execute("UPDATE overrides SET state='quarantined' WHERE id=?", (override_id,))
            override_id = None
        else:
            required = "confirmed" if override["effect"] == "positive" else "conflicting"
            cited_ids = json.loads(override["evidence_ids"])
            # Overrides cite immutable records, not replaceable proof slots.
            # Retire redundant decisions; otherwise both current and cited proof
            # must still support the effect before the next revision can use it.
            if proof != required:
                db.execute("UPDATE overrides SET state='quarantined' WHERE id=?", (override_id,))
                override_id = None
                if override["effect"] == "positive":
                    status, reason = proof, "override_evidence_no_longer_sufficient"
            elif retire_overrides and status == required:
                db.execute("UPDATE overrides SET state='retired' WHERE id=?", (override_id,))
                override_id = None
            elif (not set(cited_ids) <= set(json.loads(row["evidence_ids"]))
                  or compare(native, evidence_rows(db, cited_ids), target_native, target_evidence, row["scope"]) != required):
                db.execute("UPDATE overrides SET state='quarantined' WHERE id=?", (override_id,))
                override_id = None
            else:
                status, reason = ("confirmed", "positive_override") if override["effect"] == "positive" else ("rejected", "negative_override")
    db.execute("""UPDATE mappings SET status=?,reason=?,rule_id=?,rule_version=?,evidence_versions=?,
               revision=revision+1,active_override=? WHERE id=?""",
               (status, reason, rule, version, dumps(evidence_versions), override_id, row["id"]))
    return record_revision(db, row["id"])


def repair_candidate(db, row, rules, expected_versions):
    """One supported correction: newly sufficient evidence joins one proven peer.

    Preserve the original subject reference and expose the new target in history;
    never use this for a contradicted previously-confirmed investment intent.
    """
    if (row["status"] != "candidate" and row["reason"] != "ambiguous_existing_subjects") or row["active_override"]:
        return row
    native = json.loads(row["native_key"])
    records = evidence_rows(db, json.loads(row["evidence_ids"]))
    original = subject_row(db, row["intent_subject"])
    if compare(native, records, json.loads(original["native_ref"]),
               evidence_rows(db, json.loads(original["evidence_ids"])), row["scope"]) == "conflicting":
        return row
    choices = []
    for subject in db.execute("""SELECT * FROM subjects WHERE kind=? AND id!=? AND EXISTS
            (SELECT 1 FROM mappings WHERE target=subjects.id AND status='confirmed')""", (row["scope"], row["target"])):
        evidence = target_records(db, subject)
        if not evidence_current(records + evidence, expected_versions):
            continue
        if compare(native, records, json.loads(subject["native_ref"]), evidence, row["scope"]) == "confirmed":
            choices.append(subject["id"])
    if len(choices) == 1:
        db.execute("UPDATE mappings SET target=?,reason='repaired_candidate' WHERE id=?", (choices[0], row["id"]))
    elif len(choices) > 1:
        db.execute("UPDATE mappings SET status='conflicting',reason='ambiguous_existing_subjects' WHERE id=?", (row["id"],))
    else:
        return row
    return db.execute("SELECT * FROM mappings WHERE id=?", (row["id"],)).fetchone()


def repair(db, rules, expected_versions):
    """Only changed rule/source dependencies touch rows; transaction owns atomicity."""
    changed = []
    for row in db.execute("SELECT * FROM mappings ORDER BY id").fetchall():
        native = json.loads(row["native_key"])
        evidence = evidence_rows(db, json.loads(row["evidence_ids"]))
        rule = rule_for(native, row["scope"], evidence)
        target = subject_row(db, row["target"])
        versions = dependencies(native, evidence, rules, expected_versions, target_records(db, target),
                                json.loads(target["native_ref"]), row["scope"])
        if (row["rule_id"] == rule and row["rule_version"] == rules.versions.get(rule)
                and json.loads(row["evidence_versions"]) == versions):
            continue
        row = repair_candidate(db, row, rules, expected_versions)
        changed.append(apply_evaluation(db, row, rules, expected_versions, retire_overrides=True))
    return changed
