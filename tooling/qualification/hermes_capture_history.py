"""Persisted history, fixed notice text and CLI output from pinned Hermes.

Every string Desk parses comes from the Hermes function that produces it
(notice formatters, tool handlers, the tool-result message builder, the
steer delivery helper); rows are stored through the real ``SessionDB`` and
read back through the API-server session routes.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from hermes_capture_guard import BLOCKED_MARKER
from hermes_capture_runs import (
    CAPTURE_EPOCH,
    CHILD_SESSION,
    SESSION,
    adapter_app,
    capture_agent_class,
    exchange,
    new_adapter,
)


def tool_call(call_id: str, name: str, args: dict) -> dict:
    """The OpenAI-format record chat_completion_helpers.build_assistant_message persists."""
    return {
        "id": call_id,
        "call_id": call_id,
        "response_item_id": f"fc_{call_id}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


def notices() -> dict[str, str]:
    from gateway.run import GatewayRunner
    from tools.process_registry import format_process_notification

    base = {
        "type": "async_delegation",
        "role": "leaf",
        "model": "capture-model",
        "dispatched_at": CAPTURE_EPOCH,
        "completed_at": CAPTURE_EPOCH + 90,
        "api_calls": 3,
        "duration_seconds": 90,
    }
    single_done = format_process_notification(
        {
            **base,
            "delegation_id": "deleg-capture-1",
            "goal": "Summarize the risk factors",
            "status": "completed",
            "summary": "Three risk factors changed materially.",
        }
    )
    single_failed = format_process_notification(
        {
            **base,
            "delegation_id": "deleg-capture-2",
            "goal": "Compare segment margins",
            "status": "failed",
            "error": "Segment data was unavailable.",
        }
    )
    batch = {
        **base,
        "delegation_id": "deleg-capture-3",
        "is_batch": True,
        "goals": ["Summarize the risk factors", "Compare segment margins"],
    }
    batch_failed = format_process_notification(
        {
            **batch,
            "results": [
                {"task_index": 0, "status": "completed", "summary": "Done.", "api_calls": 2},
                {"task_index": 1, "status": "failed", "error": "Segment data was unavailable."},
            ],
        }
    )
    batch_truncated = format_process_notification(
        {
            **batch,
            "results": [
                {"task_index": 0, "status": "completed", "summary": "Done."},
                {
                    "task_index": 1,
                    "status": "completed",
                    "summary": "Partial comparison.",
                    "exit_reason": "max_iterations",
                },
            ],
        }
    )
    process_done = format_process_notification(
        {
            "type": "completion",
            "session_id": "proc_capture_1",
            "command": "python3 fetch_filings.py",
            "exit_code": 0,
            "output": "fetched 4 filings",
        }
    )
    watch_match = format_process_notification(
        {
            "type": "watch_match",
            "session_id": "proc_capture_2",
            "command": "tail -f fetch.log",
            "pattern": "ERROR",
            "output": "ERROR rate limited",
        }
    )
    coalesced_processes = GatewayRunner._format_coalesced_process_completions(
        [
            (process_done, {"session_id": "proc_capture_1", "exit_code": 0, "output": "ok"}, None),
            (process_done, {"session_id": "proc_capture_3", "exit_code": 1, "output": "failed"}, None),
        ]
    )
    coalesced_delegations = GatewayRunner._format_coalesced_async_delegations(
        [single_done, single_failed]
    )
    return {
        "async_delegation_completed": single_done,
        "async_delegation_failed": single_failed,
        "async_delegation_batch_failed": batch_failed,
        "async_delegation_batch_truncated": batch_truncated,
        "background_process_completed": process_done,
        "background_watch_match": watch_match,
        "coalesced_process_completions": coalesced_processes,
        "coalesced_async_delegations": coalesced_delegations,
    }


def tool_results() -> dict[str, str]:
    from tools.delegate_tool import delegate_task
    from tools.interrupt import set_interrupt
    from tools.terminal_tool import terminal_tool
    from tools.todo_tool import TodoStore, todo_tool
    from tools.web_tools import web_search_tool

    store = TodoStore()
    plan = todo_tool(
        todos=[
            {"id": "filings", "content": "Collect the filings", "status": "completed"},
            {"id": "margins", "content": "Compare margins", "status": "in_progress"},
            {"id": "memo", "content": "Draft the memo", "status": "pending"},
        ],
        store=store,
    )
    invalid_plan = todo_tool(todos="not a list", store=store)
    # The interrupt guard returns web_search's real error before any backend.
    set_interrupt(True)
    try:
        interrupted_search = web_search_tool("ACME 2025 annual report")
    finally:
        set_interrupt(False)
    return {
        "terminal_failed": terminal_tool(command="echo partial; exit 3"),
        "terminal_ok": terminal_tool(command="echo fetched"),
        "web_search_interrupted": interrupted_search,
        "todo": plan,
        "todo_invalid": invalid_plan,
        "delegate_task_without_parent": delegate_task(goal="Summarize the risk factors"),
    }


async def session_history(results: dict[str, str], texts: dict[str, str]) -> dict:
    from aiohttp.test_utils import TestClient, TestServer

    from agent.agent_runtime_helpers import apply_pending_steer_to_tool_results
    from agent.context_compressor import HISTORICAL_TASK_HEADING, SUMMARY_PREFIX, _SUMMARY_END_MARKER
    from agent.tool_dispatch_helpers import make_tool_result_message
    from tools.delegate_tool import DELEGATE_TASK_SCHEMA
    from tools.registry import tool_error
    from tools.tool_search import TOOL_CALL_NAME, bridge_tool_schemas

    delegate_properties = DELEGATE_TASK_SCHEMA["parameters"]["properties"]
    task_properties = delegate_properties["tasks"]["items"]["properties"]
    if "action" not in delegate_properties or not {"goal", "context"} <= set(task_properties):
        raise RuntimeError("delegate_task no longer accepts tasks[].{goal, context} and action.")
    bridge_args = {"name": "pythia_eod_prices", "arguments": {"symbol": "ACME.US"}}
    bridge = next(s["function"] for s in bridge_tool_schemas(1) if s["function"]["name"] == TOOL_CALL_NAME)
    if set(bridge["parameters"]["required"]) != set(bridge_args):
        raise RuntimeError("The tool_call bridge no longer takes {name, arguments}.")

    calls = [
        tool_call("call_terminal", "terminal", {"command": "echo partial; exit 3"}),
        tool_call("call_search", "web_search", {"query": "ACME 2025 annual report"}),
        tool_call("call_todo", "todo", {"todos": json.loads(results["todo"])["todos"]}),
        tool_call("call_todo_invalid", "todo", {"todos": "not a list"}),
        tool_call(
            "call_delegate",
            "delegate_task",
            {
                "tasks": [
                    {"goal": "Summarize the risk factors in the 2025 annual report"},
                    {"goal": "Compare segment margins", "context": "Use the 2025 filing."},
                ]
            },
        ),
        tool_call("call_bridge", "tool_call", bridge_args),
    ]
    tool_messages = [
        make_tool_result_message("terminal", results["terminal_failed"], "call_terminal"),
        make_tool_result_message("web_search", results["web_search_interrupted"], "call_search"),
        make_tool_result_message("todo", results["todo"], "call_todo"),
        make_tool_result_message("todo", results["todo_invalid"], "call_todo_invalid"),
        make_tool_result_message("delegate_task", results["delegate_task_without_parent"], "call_delegate"),
        make_tool_result_message("tool_call", tool_error("EODHD is not configured"), "call_bridge"),
    ]
    # A steer accepted mid-batch is delivered the pinned way: appended to the
    # last tool result, never as its own row.
    steered = capture_agent_class()(lambda agent: {}, {})
    if not steered.steer("Focus on 2025 only."):
        raise RuntimeError("AIAgent.steer rejected the capture steer.")
    apply_pending_steer_to_tool_results(steered, tool_messages, len(tool_messages))

    compaction_summary = f"{SUMMARY_PREFIX}\n\n{HISTORICAL_TASK_HEADING}\nold work\n\n{_SUMMARY_END_MARKER}"
    rows: list[dict] = [
        {"role": "user", "content": "Compare ACME's 2025 filing with the prior year."},
        {
            "role": "assistant",
            "content": "",
            "reasoning": "I need the filing, a plan and two research agents.",
            "tool_calls": calls,
            "finish_reason": "tool_calls",
        },
        *tool_messages,
        {"role": "assistant", "content": "The 2025 filing adds three risk factors.", "finish_reason": "stop"},
        {"role": "user", "content": compaction_summary},
        # conversation_loop's empty interrupt placeholder.
        {"role": "assistant", "content": "", "display_kind": "hidden"},
        # The API-server wake path stores notices unmarked; the chat gateway
        # marks them internal_notification (gateway/run.py).
        {"role": "user", "content": texts["async_delegation_completed"]},
        {"role": "user", "content": texts["async_delegation_failed"]},
        {"role": "user", "content": texts["async_delegation_batch_failed"]},
        {"role": "user", "content": texts["async_delegation_batch_truncated"]},
        {"role": "user", "content": texts["background_process_completed"]},
        {"role": "user", "content": texts["background_watch_match"]},
        *(
            {"role": "user", "content": texts[name], "display_kind": "internal_notification"}
            for name in ("coalesced_process_completions", "coalesced_async_delegations")
        ),
    ]

    adapter = new_adapter()
    database = adapter._ensure_session_db()
    database.create_session(SESSION, "api_server")
    database.create_session(
        CHILD_SESSION,
        "subagent",
        parent_session_id=SESSION,
        model="capture-model",
        # delegate_tool marks subagent children so resume never follows them.
        model_config={"_delegate_from": SESSION},
    )
    from time import time as wall_clock

    base = wall_clock() - 3600
    database.append_message(
        CHILD_SESSION,
        "user",
        "Summarize the risk factors in the 2025 annual report and compare them with 2024.",
        timestamp=base,
    )
    persisted = ("content", "tool_name", "tool_calls", "tool_call_id", "finish_reason", "reasoning", "display_kind")
    for offset, row in enumerate(rows, start=1):
        database.append_message(
            SESSION,
            row["role"],
            timestamp=base + offset,
            **{key: row[key] for key in persisted if key in row and key != "role"},
        )
    async with TestClient(TestServer(adapter_app(adapter))) as client:
        messages = await exchange(
            client, "GET", f"/api/sessions/{SESSION}/messages?limit=100&offset=0&order=latest"
        )
        agents = await exchange(
            client, "GET", "/api/sessions?include_children=true&limit=200&offset=0&source=subagent"
        )
        child = await exchange(client, "GET", f"/api/sessions/{CHILD_SESSION}")
    return {"exchanges": [messages, agents, child]}


def formatters() -> dict:
    from agent.display import build_tool_preview
    from agent.prompt_builder import format_steer_marker
    from agent.tool_dispatch_helpers import make_tool_result_message
    from hermes_state_common import _shape_preview
    from tools.delegate_tool import DELEGATE_TASK_SCHEMA
    from tools.tool_search import TOOL_CALL_NAME, bridge_tool_schemas

    bridge = next(
        schema["function"]
        for schema in bridge_tool_schemas(1)
        if schema["function"]["name"] == TOOL_CALL_NAME
    )
    delegate = DELEGATE_TASK_SCHEMA["parameters"]
    long_goal = "Summarize the risk factors in the 2025 annual report and compare them with 2024."
    return {
        "steer_marker": format_steer_marker("Focus on 2025 only."),
        "untrusted_web_search_result": make_tool_result_message(
            "web_search",
            '{"success": true, "data": {"web": [{"title": "ACME annual report", "url": "https://example.com/acme-2025"}]}}',
            "call_capture",
        )["content"],
        "session_preview": {"input": long_goal, "preview": _shape_preview(long_goal)},
        "tool_call_bridge": {
            "name": bridge["name"],
            "required": bridge["parameters"]["required"],
            "properties": sorted(bridge["parameters"]["properties"]),
            "preview": build_tool_preview(
                "tool_call", {"name": "pythia_eod_prices", "arguments": {"symbol": "ACME.US"}}
            ),
        },
        "delegate_task_schema": {
            "properties": sorted(delegate["properties"]),
            "task_properties": sorted(delegate["properties"]["tasks"]["items"]["properties"]),
            "actions": delegate["properties"]["action"].get("enum"),
        },
    }


def cli(hermes_source: Path, environment: dict[str, str], cwd: Path) -> dict:
    """The pinned ``hermes`` entry point, run under the capture network guard."""
    guarded = [
        str(hermes_source / ".venv" / "bin" / "python"),
        str(Path(__file__).resolve().parent / "hermes_capture_guard.py"),
    ]
    results = {}
    for name, command in {
        "auth_status_logged_out": ["-p", "default", "auth", "status", "openai-codex"],
        "config_get_missing": ["-p", "default", "config", "get", "capture.missing", "--json"],
    }.items():
        completed = subprocess.run(
            [*guarded, *command],
            cwd=cwd,
            env=environment,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if BLOCKED_MARKER in completed.stderr:
            raise RuntimeError(f"hermes {' '.join(command)} attempted network access.")
        results[name] = {
            "args": command,
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
    return results
