"""Offline native Workspace seam qualification; no listeners or model calls.

Fixtures follow pinned hermes_state.py/search.py native method contracts and
tests/agent/test_plugin_prompt_sections.py. Production code must use the same
read-only methods, never the fixture's native write operations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
from types import SimpleNamespace

from native_hermes_source import validate_source_binding


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    args = parser.parse_args()
    source = args.hermes_source.resolve()
    repository = args.repository.resolve()
    pin = json.loads((repository / "runtime/versions.json").read_text())["dependencies"]["hermes_agent"]
    binding = validate_source_binding(source, pin, None)
    assert Path(sys.prefix).resolve() == (source / ".venv").resolve()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source))

    def deny_network(*_args, **_kwargs):
        raise RuntimeError("Network prohibited in Workspace qualification")

    socket.create_connection = deny_network
    socket.socket.connect = deny_network
    with tempfile.TemporaryDirectory(prefix="pythia-workspace-native-") as raw:
        root = Path(raw)
        original_environment = dict(os.environ)
        previous_cwd = Path.cwd()
        try:
            os.environ.clear()
            os.environ.update({"HOME": raw, "HERMES_HOME": str(root / "profile"),
                               "HERMES_DISABLE_LAZY_INSTALLS": "1", "PATH": "/usr/bin:/bin"})
            os.chdir(root)
            from hermes_state import SessionDB
            from hermes_cli import plugins
            from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest
            from agent.system_prompt import _frozen_plugin_prompt_sections, invalidate_system_prompt
            from model_tools import handle_function_call

            path = root / "state.db"
            writer = SessionDB(db_path=path)
            marker = "PYTHIA_WORKSPACE_SCOPE_V1"
            note = "[" + marker + "]" + ' {"origin":"scope-origin","brief":"strategies/income/README.md"}'
            structured = [{"type": "text", "text": "Research this.\n" + note},
                          {"type": "image_url", "image_url": {"url": "data:image/png;base64,c3ludGhldGlj"}}]
            writer.create_session("scope-origin", source="api_server")
            original_id = writer.append_message("scope-origin", "user", structured)
            assert writer.get_messages("scope-origin")[0]["content"] == structured
            for iteration in range(3):
                writer.archive_and_compact("scope-origin", [{"role": "user", "content": f"Lossy summary {iteration}"}])
            assert all(marker not in str(row["content"]) for row in writer.get_messages("scope-origin"))
            writer.end_session("scope-origin", "compression")
            writer.create_session("scope-child", source="api_server", parent_session_id="scope-origin")
            writer.append_message("scope-child", "user", "Continue")
            writer.end_session("scope-child", "compression")
            writer.create_session("scope-tip", source="api_server", parent_session_id="scope-child")
            writer.create_session("unrelated", source="api_server")
            writer.append_message("unrelated", "user", note)
            writer.create_session("rewind", source="api_server")
            rewind_id = writer.append_message("rewind", "user", marker + " rewind")
            reader = SessionDB(db_path=path, read_only=True)
            fields = {"id", "session_id", "role", "snippet"}
            hits = reader.search_messages(marker, role_filter=["user"], fields=fields, sort="oldest", limit=20)
            assert all(set(hit) == fields for hit in hits)
            assert any(hit["id"] == original_id for hit in hits)
            scoped_hits = reader.search_messages(f'"{marker}" "scope-origin"', role_filter=["user"], fields=fields, sort="oldest", limit=20)
            assert any(hit["id"] == original_id for hit in scoped_hits)
            lineage = reader.get_compression_lineage("scope-tip")
            assert lineage == ["scope-origin", "scope-child", "scope-tip"]
            # This native method includes descendants even for an ancestor request.
            assert reader.get_compression_lineage("scope-origin") == lineage
            anchor = reader.get_messages_around("scope-origin", original_id, window=0)["window"][0]
            assert anchor["content"] == structured and anchor["active"] == 0 and anchor["compacted"] == 1
            assert reader.get_messages_around("unrelated", original_id, window=0)["window"] == []
            writer.rewind_to_message("rewind", rewind_id)
            assert not any(hit["id"] == rewind_id for hit in reader.search_messages(marker, fields=fields))
            withdrawn = reader.get_messages_around("rewind", rewind_id, window=0)["window"][0]
            assert withdrawn["active"] == 0 and withdrawn["compacted"] == 0
            writer.set_meta("fts_rebuild_high_water", "100")
            writer.set_meta("fts_rebuild_progress", "1")
            assert reader.fts_rebuild_status()["pending"] is True
            writer.set_meta("fts_stale", "1")
            fallback = reader.search_messages(marker, fields=fields)
            assert any(hit["session_id"] == "unrelated" for hit in fallback)
            assert not any(hit["id"] == original_id for hit in fallback)
            assert reader.get_meta("fts_stale") == "1"
            # Native supported status read is required: readonly constructor does
            # not establish index completeness merely by probing table presence.
            reader.close()
            writer.close()
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            reader = SessionDB(db_path=path, read_only=True)
            assert reader.fts_rebuild_status()["indexed"] == 1
            assert reader.get_session("scope-origin")
            reader.search_messages(marker, fields=fields)
            reader.close()
            assert hashlib.sha256(path.read_bytes()).hexdigest() == before
            empty = root / "empty.db"
            empty.touch()
            broken = SessionDB(db_path=empty, read_only=True)
            try:
                try:
                    broken.get_session("missing")
                    raise AssertionError("Empty schema unexpectedly readable")
                except Exception as error:
                    assert "no such table" in str(error)
            finally:
                broken.close()

            manager = PluginManager()
            manager._discovered = True
            plugins._plugin_manager = manager
            context = PluginContext(PluginManifest(name="workspace-probe", key="workspace-probe", source="user"), manager)
            views = {"view-a": ("session-a", "first"), "view-b": ("session-a", "second")}

            def view_handler(arguments, **kwargs):
                record = views.get(arguments.get("view_reference"))
                return json.dumps({"status": "ok", "view": record[1]} if record and record[0] == kwargs.get("session_id") else {"status": "unavailable"})

            context.register_tool(name="workspace_probe_view", toolset="workspace-probe", schema={"name": "workspace_probe_view", "parameters": {"type": "object", "properties": {"view_reference": {"type": "string"}}, "required": ["view_reference"]}}, handler=view_handler)
            results = []
            for reference, session in [("view-a", "session-a"), ("view-b", "session-a"), ("view-a", "session-b")]:
                result = handle_function_call("workspace_probe_view", {"view_reference": reference}, session_id=session)
                assert isinstance(result, str)
                results.append(json.loads(result))
            assert results == [{"status": "ok", "view": "first"}, {"status": "ok", "view": "second"}, {"status": "unavailable"}]
            renders = []

            def section(info):
                renders.append(info["session_id"])
                return "Managed guidance " + str(len(renders))

            context.register_system_prompt_section("workspace.probe", section, position="after_memory", max_chars=1000)
            agent = SimpleNamespace(session_id="session-a", _memory_store=None)
            first = _frozen_plugin_prompt_sections(agent)
            assert _frozen_plugin_prompt_sections(agent) == first and len(renders) == 1
            invalidate_system_prompt(agent)
            second = _frozen_plugin_prompt_sections(agent)
            assert len(renders) == 2 and second != first
            print(json.dumps({"source_binding": binding, "commit": pin["commit"], "checks": ["structured-history", "three-compactions", "two-rotations", "exact-anchor", "rewind-race-eligibility", "readonly-db-byte-preservation", "repair-status-and-structured-fallback-limitation", "empty-schema", "native-dispatch-session-string", "two-view-bindings", "prompt-freeze-and-invalidation"]}))
        finally:
            os.chdir(previous_cwd)
            os.environ.clear()
            os.environ.update(original_environment)


if __name__ == "__main__":
    main()
