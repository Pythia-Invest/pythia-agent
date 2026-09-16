"""Provider-free T2a checks against the exact native DB and prompt framing.

Synthetic fixtures use pinned SessionDB mutation APIs. The missing-index case
uses the native capability seam because SQL/schema copies are forbidden.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

from native_hermes_source import validate_source_binding


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", required=True, type=Path)
    parser.add_argument("--repository", required=True, type=Path)
    args = parser.parse_args()
    source = args.hermes_source.resolve()
    repository = args.repository.resolve()
    pin = json.loads((repository / "runtime/versions.json").read_text())["dependencies"]["hermes_agent"]
    binding = validate_source_binding(source, pin, None)
    assert Path(sys.prefix).resolve() == (source / ".venv").resolve()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source))
    helper = repository / "runtime/managed/runner/native_session_context.py"
    spec = importlib.util.spec_from_file_location("session_context", helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def deny_network(*_args, **_kwargs):
        raise RuntimeError("Network disabled")

    socket.socket.connect = deny_network
    socket.create_connection = deny_network
    with tempfile.TemporaryDirectory(prefix="pythia-session-context-") as raw:
        root = Path(raw)
        original_environment = dict(os.environ)
        previous_cwd = Path.cwd()
        try:
            os.environ.clear()
            os.environ.update({"HOME": raw, "HERMES_HOME": str(root / "profile"), "HERMES_DISABLE_LAZY_INSTALLS": "1", "PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"})
            os.chdir(root)
            from hermes_state import SessionDB
            from hermes_cli.plugins import format_system_prompt_sections, RenderedPluginSystemPromptSection

            section = RenderedPluginSystemPromptSection(id="pythia.operating", content=module.GUIDANCE_MARKER + "\nSynthetic research rules.", position="after_memory", plugin="pythia")
            prompt = format_system_prompt_sections([section]) + "\n\nConversation started: synthetic"
            assert module.guidance_status(prompt) == "current"
            assert module.guidance_status(module.GUIDANCE_MARKER) == "legacy"
            assert module.guidance_status(None) == "unavailable"
            db_path = root / "state.db"
            writer = SessionDB(db_path=db_path)

            # Native first-input eligibility: active message_count alone resets
            # after rewind/compaction; a LIMIT 1 audit read sees retained rows.
            first_input_reader = SessionDB(db_path=db_path, read_only=True)
            def first_input_facts(session):
                row = first_input_reader.get_session(session)
                return {
                    key: row.get(key) for key in ["system_prompt", "system_prompt_hash", "message_count", "rewind_count", "api_call_count", "parent_session_id", "ended_at", "end_reason", "last_activity_at"]
                } | {"hasRetainedRows": bool(first_input_reader.get_messages(session, include_inactive=True, include_compacted=False, limit=1))}

            writer.create_session("untouched", source="api_server")
            untouched = first_input_facts("untouched")
            assert not untouched["hasRetainedRows"] and untouched["system_prompt"] is None and untouched["message_count"] == 0
            assert untouched["api_call_count"] == 0 and untouched["rewind_count"] == 0
            writer.create_session("first-input", source="api_server")
            first_id = writer.append_message("first-input", "user", "Synthetic input")
            assert first_input_facts("first-input")["hasRetainedRows"]
            writer.rewind_to_message("first-input", first_id)
            rewound_first = first_input_facts("first-input")
            assert rewound_first["message_count"] == 0 and rewound_first["hasRetainedRows"] and rewound_first["rewind_count"] == 1
            writer.create_session("empty-compaction", source="api_server")
            writer.append_message("empty-compaction", "user", "Synthetic input")
            writer.archive_and_compact("empty-compaction", [])
            compacted_first = first_input_facts("empty-compaction")
            assert compacted_first["message_count"] == 0 and compacted_first["hasRetainedRows"]
            writer.create_session("prompt-only", source="api_server")
            writer.update_system_prompt("prompt-only", "Synthetic old prompt")
            prompt_only = first_input_facts("prompt-only")
            assert not prompt_only["hasRetainedRows"] and prompt_only["system_prompt"] and prompt_only["system_prompt_hash"]
            writer.create_session("empty-parent", source="api_server")
            writer.end_session("empty-parent", "compression")
            writer.create_session("empty-child", source="api_server", parent_session_id="empty-parent")
            assert first_input_facts("empty-parent")["ended_at"] is not None
            assert first_input_facts("empty-child")["parent_session_id"] == "empty-parent"
            eligible_result = module.read_context(first_input_reader, "untouched")
            assert eligible_result == {"status": "ok", "guidance": "unavailable", "firstInputEligible": True, "scope": {"status": "none"}}, eligible_result
            for old_id in ["first-input", "empty-compaction", "prompt-only", "empty-parent", "empty-child"]:
                assert module.read_context(first_input_reader, old_id)["firstInputEligible"] is False, old_id
            first_input_reader.close()

            def create(session, brief=None, structured=False):
                writer.create_session(session, source="api_server")
                writer.update_system_prompt(session, prompt)
                if brief:
                    note = module.SCOPE_MARKER + " " + json.dumps({"version": 1, "originSessionId": session, "briefPath": brief})
                    content = [{"type": "text", "text": "Research\n" + note}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,c3ludGhldGlj"}}] if structured else note
                    return writer.append_message(session, "user", content)
                return None

            anchor = create("origin", "strategies/income/README.md", True)
            for i in range(3):
                writer.archive_and_compact("origin", [{"role": "user", "content": f"Summary {i}"}])
            # T7 repeats provenance in references, reserving the searchable
            # opening marker for the original association. Routine long chats
            # therefore do not exhaust the helper's bounded opening search.
            continuity = "[PYTHIA_WORKSPACE_REFERENCES_V1] " + json.dumps({"references": [], "strategy": {"version": 1, "originSessionId": "origin", "briefPath": "strategies/income/README.md"}})
            for i in range(70):
                writer.append_message("origin", "user", f"Continue {i}\n{continuity}")
                if i % 10 == 9:
                    writer.archive_and_compact("origin", [{"role": "user", "content": f"Continuity summary {i}"}])
            copied_summary = module.SCOPE_MARKER + ' {"version":1,"originSessionId":"origin","briefPath":"strategies/summary-guess/README.md"}'
            summary_id = writer.append_message("origin", "user", copied_summary, _compressed_summary=True)
            writer.end_session("origin", "compression")
            writer.create_session("child", source="api_server", parent_session_id="origin")
            writer.update_system_prompt("child", prompt)
            writer.end_session("child", "compression")
            writer.create_session("tip", source="api_server", parent_session_id="child")
            writer.update_system_prompt("tip", prompt)
            # Later descendant scope cannot contaminate an ancestor request.
            writer.append_message("tip", "user", module.SCOPE_MARKER + ' {"version":1,"originSessionId":"tip","briefPath":"strategies/growth/README.md"}')
            create("general")
            create("summary-only")
            summary_only_id = writer.append_message("summary-only", "user", module.SCOPE_MARKER + ' {"version":1,"originSessionId":"summary-only","briefPath":"strategies/guessed/README.md"}', _compressed_summary=True)
            authored_id = create("authored", "strategies/authored/README.md")
            writer.create_session("fork", source="api_server", parent_session_id="origin", model_config={"_branched_from": "origin"})
            writer.update_system_prompt("fork", prompt)
            create("malformed")
            writer.append_message("malformed", "user", module.SCOPE_MARKER + ' {"version":1,"originSessionId":"malformed","briefPath":"../escape"}')
            create("unrelated", "strategies/other/README.md")
            race_id = create("race", "strategies/income/README.md")
            gone_id = create("gone", "strategies/income/README.md")
            writer.rewind_to_message("gone", gone_id)
            reader = SessionDB(db_path=db_path, read_only=True)
            assert reader.get_messages_around("origin", summary_id, window=0)["window"][0]["_compressed_summary"] == 1
            assert reader.get_messages_around("summary-only", summary_only_id, window=0)["window"][0]["_compressed_summary"] == 1
            assert reader.get_messages_around("authored", authored_id, window=0)["window"][0]["_compressed_summary"] == 0
            assert module.read_context(reader, "summary-only")["scope"]["reason"] == "summary_only_scope"
            assert module.read_context(reader, "authored")["scope"]["status"] == "resolved"
            result = module.read_context(reader, "child")
            assert result["status"] == "ok" and result["guidance"] == "current", result
            assert result["scope"]["reference"]["originSessionId"] == "origin", result
            assert module.read_context(reader, "origin")["scope"]["reference"]["briefPath"] == "strategies/income/README.md"
            assert module.read_context(reader, "tip")["scope"]["reason"] == "ambiguous_scope"
            assert module.read_context(reader, "general")["scope"] == {"status": "none"}
            assert module.read_context(reader, "fork")["scope"] == {"status": "none"}
            assert module.read_context(reader, "malformed")["scope"]["reason"] == "ambiguous_scope"
            assert module.read_context(reader, "general", created_after=0)["status"] == "ok"
            assert module.read_context(reader, "general", created_after=float("inf"))["scope"]["reason"] == "fresh_session_required"
            assert module.read_context(reader, "general", created_after=reader.get_session("general")["started_at"])["scope"]["reason"] == "fresh_session_required"
            assert module.read_context(reader, "gone")["scope"] == {"status": "none"}
            assert module.read_context(reader, "missing")["scope"]["reason"] == "session_missing"
            assert module.read_context(reader, "general", seconds=-1)["scope"]["reason"] == "deadline"
            native_anchor = reader.get_messages_around

            def racing_anchor(session, message_id, window=0):
                if session == "race":
                    writer.rewind_to_message("race", race_id)
                return native_anchor(session, message_id, window=window)

            reader.get_messages_around = racing_anchor
            assert module.read_context(reader, "race")["scope"]["reason"] == "anchor_withdrawn"
            reader.get_messages_around = native_anchor
            reader._fts_enabled = False
            assert module.read_context(reader, "child")["scope"]["reason"] == "search_unavailable"
            reader._fts_enabled = True
            writer.set_meta("fts_rebuild_high_water", "100")
            writer.set_meta("fts_rebuild_progress", "1")
            assert module.read_context(reader, "child")["scope"]["reason"] == "search_repair_pending"
            reader.close()
            writer.close()
            before = hashlib.sha256(db_path.read_bytes()).hexdigest()
            completed = subprocess.run([sys.executable, "-B", str(helper), "--db", str(db_path)], input=json.dumps({"sessionId": "child"}), capture_output=True, text=True, timeout=5, env=dict(os.environ))
            assert completed.returncode == 0, completed.stderr
            projected = json.loads(completed.stdout)
            assert projected["guidance"] == "current" and projected["scope"]["reason"] == "search_repair_pending", projected
            assert "Synthetic research rules" not in completed.stdout and "Summary" not in completed.stdout
            assert hashlib.sha256(db_path.read_bytes()).hexdigest() == before
            rejected = subprocess.run([sys.executable, "-B", str(helper), "--db", str(db_path)], input="x" * 2049, capture_output=True, text=True, timeout=5, env=dict(os.environ))
            assert json.loads(rejected.stdout)["scope"]["reason"] in {"invalid_request", "native_read_failed"}
            print(json.dumps({"source_binding": binding, "checks": ["native-framed-guidance", "structured-three-compactions-two-rotations", "ancestor-only", "ambiguous", "general", "rewound", "rewind-race", "missing-session", "missing-index", "repair-pending", "deadline", "subprocess-small-projection", "readonly-byte-preservation", "oversized-input"]}))
        finally:
            os.chdir(previous_cwd)
            os.environ.clear()
            os.environ.update(original_environment)


if __name__ == "__main__":
    main()
