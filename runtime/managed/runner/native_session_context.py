"""Bounded read-only projection of native session scope and guidance status.

Hermes owns all persistence, schema, search and compaction. This process returns
only Pythia reference provenance, never transcript or system-prompt content.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import sys
import time
from typing import Any

SCOPE_MARKER = "[PYTHIA_WORKSPACE_SCOPE_V1]"
GUIDANCE_MARKER = "[PYTHIA_WORKSPACE_GUIDANCE_V1]"
SESSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
MAX_INPUT = 2048
MAX_CONTENT = 2_000_000
MAX_LINEAGE = 16
PAGE_SIZE = 20
MAX_PAGES = 3
MAX_CANDIDATES = 200


def valid_reference(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"version", "originSessionId", "briefPath"}:
        return False
    origin = value["originSessionId"]
    path = value["briefPath"]
    return (
        type(value["version"]) is int and value["version"] == 1
        and isinstance(origin, str) and SESSION_ID.fullmatch(origin) is not None
        and isinstance(path, str) and len(path) <= 1024
        and re.fullmatch(r"strategies/[^/\\\x00-\x1f\x7f]+/README\.md", path) is not None
        and path.split("/")[1] not in {".", ".."}
    )


def scope_notes(content: Any) -> tuple[list[dict], bool]:
    """Parse exact single-line notes from native scalar or multimodal content."""
    if isinstance(content, str):
        texts = [content]
    elif isinstance(content, list):
        texts = [part["text"] for part in content if isinstance(part, dict)
                 and part.get("type") == "text" and isinstance(part.get("text"), str)]
    else:
        return [], False
    if sum(len(text) for text in texts) > MAX_CONTENT:
        return [], True
    notes = []
    malformed = False
    for text in texts:
        for line in text.splitlines():
            if SCOPE_MARKER not in line:
                continue
            if not line.startswith(SCOPE_MARKER + " "):
                malformed = True
                continue
            try:
                value = json.loads(line[len(SCOPE_MARKER) + 1:])
            except (ValueError, TypeError):
                malformed = True
                continue
            if valid_reference(value):
                notes.append(value)
            else:
                malformed = True
    return notes, malformed


def guidance_status(prompt: Any) -> str:
    if not isinstance(prompt, str) or not prompt:
        return "unavailable"
    if len(prompt) > MAX_CONTENT:
        return "unavailable"
    # Consume the native persisted-section parser; do not copy its framing.
    from agent.system_prompt import _restore_plugin_prompt_sections

    sections = _restore_plugin_prompt_sections(prompt)
    return "current" if any(section.id == "pythia.operating" and
                            GUIDANCE_MARKER in section.content.splitlines()
                            for section in sections) else "legacy"


def unavailable(reason: str, guidance: str = "unavailable") -> dict:
    return {"status": "unavailable", "guidance": guidance, "firstInputEligible": False,
            "scope": {"status": "unresolved", "reason": reason}}


def first_input_eligible(db, session: dict) -> bool:
    """Snapshot with no retained context, not a claim history never existed.

    Native message_count is active-only. include_inactive=True with
    include_compacted=False selects the native SQL LIMIT path, seeing archived
    and rewound rows without full-transcript compaction deduplication or FTS.
    """
    if (session.get("system_prompt") not in (None, "")
            or session.get("system_prompt_hash") is not None
            or session.get("api_call_count") != 0
            or session.get("rewind_count") != 0
            or session.get("parent_session_id") is not None
            or session.get("ended_at") is not None
            or session.get("end_reason") is not None
            or session.get("archived") != 0):
        return False
    return not db.get_messages(session["id"], include_inactive=True,
                               include_compacted=False, limit=1)


def read_context(db, session_id: str, *, seconds: float = 1.5, created_after: float | None = None) -> dict:
    deadline = time.monotonic() + seconds
    guidance = "unavailable"

    def check_time():
        if time.monotonic() >= deadline:
            raise TimeoutError()

    def repair_pending():
        return db.get_meta("fts_stale") is not None or db.fts_rebuild_status() is not None

    def search_available():
        # Exact-pin native capability: read_only initialization SELECT-probes
        # this flag. Native search otherwise returns [] without an index.
        return getattr(db, "_fts_enabled", False) is True

    try:
        check_time()
        session = db.get_session(session_id)
        if not session:
            return unavailable("session_missing")
        guidance = guidance_status(session.get("system_prompt"))
        if created_after is not None:
            started = session.get("started_at")
            if (not math.isfinite(created_after) or not isinstance(started, (int, float))
                    or not math.isfinite(started) or started <= created_after):
                return unavailable("fresh_session_required", guidance)
        eligible = first_input_eligible(db, session)
        check_time()
        if eligible:
            # No retained native row establishes absence without an index.
            # It does not establish that current managed guidance was loaded.
            return {"status": "ok", "guidance": guidance,
                    "firstInputEligible": True, "scope": {"status": "none"}}
        lineage = db.get_compression_lineage(session_id)
        check_time()
        if session_id not in lineage or len(lineage) > MAX_LINEAGE or len(set(lineage)) != len(lineage):
            return unavailable("lineage_unresolved", guidance)
        lineage = lineage[:lineage.index(session_id) + 1]
        if any(not isinstance(item, str) or SESSION_ID.fullmatch(item) is None for item in lineage):
            return unavailable("lineage_unresolved", guidance)
        if repair_pending():
            return unavailable("search_repair_pending", guidance)
        if not search_available():
            return unavailable("search_unavailable", guidance)
        found = {}
        checked = set()
        malformed = False
        summary_seen = False
        fields = {"id", "session_id", "role", "snippet"}
        for origin in lineage:
            for page in range(MAX_PAGES):
                check_time()
                hits = db.search_messages(
                    f'"PYTHIA_WORKSPACE_SCOPE_V1" "{origin}"',
                    role_filter=["user"], include_inactive=False, fields=fields,
                    limit=PAGE_SIZE, offset=page * PAGE_SIZE, sort="oldest",
                )
                check_time()
                for hit in hits:
                    candidate_session = hit.get("session_id")
                    if candidate_session not in lineage or hit.get("role") != "user":
                        continue
                    anchor_id = hit.get("id")
                    if type(anchor_id) is not int:
                        return unavailable("invalid_native_result", guidance)
                    identity = (candidate_session, anchor_id)
                    if identity in checked:
                        continue
                    checked.add(identity)
                    if len(checked) > MAX_CANDIDATES:
                        return unavailable("search_limit", guidance)
                    check_time()
                    anchors = db.get_messages_around(candidate_session, anchor_id, window=0).get("window", [])
                    if len(anchors) != 1:
                        return unavailable("anchor_changed", guidance)
                    anchor = anchors[0]
                    if (anchor.get("id") != anchor_id or anchor.get("session_id") != candidate_session
                            or anchor.get("role") != "user"):
                        return unavailable("invalid_native_result", guidance)
                    if anchor.get("active") != 1 and anchor.get("compacted") != 1:
                        # Search and consumption are separate native transactions.
                        return unavailable("anchor_withdrawn", guidance)
                    if anchor.get("_compressed_summary") == 1:
                        # Native compaction carriers can quote machine notes.
                        # Their prose cannot establish original user provenance.
                        summary_seen = True
                        continue
                    notes, invalid = scope_notes(anchor.get("content"))
                    malformed = malformed or invalid
                    for note in notes:
                        native_origin = note["originSessionId"]
                        if native_origin not in lineage or lineage.index(native_origin) > lineage.index(candidate_session):
                            malformed = True
                            continue
                        found[(native_origin, note["briefPath"])] = note
                if len(hits) < PAGE_SIZE:
                    break
            else:
                return unavailable("search_limit", guidance)
        check_time()
        if repair_pending():
            return unavailable("search_repair_pending", guidance)
        if not search_available():
            return unavailable("search_unavailable", guidance)
        if malformed or len(found) > 1:
            return unavailable("ambiguous_scope", guidance)
        if summary_seen and not found:
            return unavailable("summary_only_scope", guidance)
        scope = {"status": "resolved", "reference": next(iter(found.values()))} if found else {"status": "none"}
        return {"status": "ok", "guidance": guidance, "firstInputEligible": False, "scope": scope}
    except TimeoutError:
        return unavailable("deadline", guidance)
    except Exception:
        return unavailable("native_read_failed", guidance)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--created-after", type=float)
    args = parser.parse_args()
    db = None
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        request = json.loads(raw) if len(raw) <= MAX_INPUT else None
        if (not isinstance(request, dict) or set(request) != {"sessionId"}
                or not isinstance(request["sessionId"], str)
                or SESSION_ID.fullmatch(request["sessionId"]) is None):
            result = unavailable("invalid_request")
        elif not args.db.is_absolute() or not args.db.is_file():
            result = unavailable("profile_unavailable")
        else:
            from hermes_state import SessionDB
            db = SessionDB(db_path=args.db, read_only=True)
            result = read_context(db, request["sessionId"], created_after=args.created_after)
    except Exception:
        result = unavailable("native_read_failed")
    finally:
        if db is not None:
            db.close()
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")


if __name__ == "__main__":
    main()
