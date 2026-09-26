"""Scripted ``/v1/runs`` scenarios against the real pinned API-server adapter.

Mirrors upstream ``tests/gateway/test_api_server_runs.py``: real
``APIServerAdapter`` routes behind aiohttp's ``TestServer`` with
``_create_agent`` replaced. The scripted agent drives the same progress,
delta, approval and steer seams the real agent loop uses.
"""

from __future__ import annotations

import asyncio
import json
import threading
from types import SimpleNamespace
from typing import Any, Callable

API_KEY = "capture-bearer-0123456789"
AUTH = {"Authorization": f"Bearer {API_KEY}"}
SESSION = "capture-session"
CHILD_SESSION = "capture-child-session"
# Fixed inputs to formatters that print dates (2026-01-01T00:00:00Z).
CAPTURE_EPOCH = 1767225600
DEADLINE_SECONDS = 20.0
CHILD_GOALS = [
    "Summarize the risk factors in the 2025 annual report",
    "Compare the reported segment margins with the prior year",
]


def capture_agent_class():
    from run_agent import AIAgent

    class CaptureAgent(AIAgent):
        """Upstream tests build AIAgent stubs without __init__ the same way."""

        def __init__(self, script: Callable[["CaptureAgent"], dict], options: dict) -> None:
            self.script = script
            self.tool_progress_callback = options.get("tool_progress_callback")
            self.stream_delta_callback = options.get("stream_delta_callback")
            self.session_prompt_tokens = 0
            self.session_completion_tokens = 0
            self.session_total_tokens = 0
            self._pending_steer = None
            self._pending_steer_lock = threading.Lock()
            self.ready = threading.Event()
            self.proceed = threading.Event()
            self.interrupted = threading.Event()

        def run_conversation(self, user_message=None, conversation_history=None, task_id=None):
            return self.script(self)

        def interrupt(self, message=None):
            self.interrupted.set()

        def hard_interrupt(self, message=None):
            self.interrupted.set()

    return CaptureAgent


def install_agent(adapter, script) -> list:
    agent_class = capture_agent_class()
    created: list = []

    def create_agent(**options):
        agent = agent_class(script, options)
        created.append(agent)
        return agent

    adapter._create_agent = create_agent
    return created


def tool(agent, name: str, args: dict, *, duration: float, error: bool = False) -> None:
    from agent.display import build_tool_preview

    callback = agent.tool_progress_callback
    callback("tool.started", name, build_tool_preview(name, args), args)
    callback("tool.completed", name, None, None, duration=duration, is_error=error)


def delegated_children(agent) -> None:
    """Relay child lifecycle through the real delegate_tool progress bridge."""
    from tools.delegate_tool import _build_child_progress_callback

    parent = SimpleNamespace(
        tool_progress_callback=agent.tool_progress_callback,
        _delegate_spinner=None,
    )
    goals = CHILD_GOALS
    callbacks = [
        _build_child_progress_callback(
            index,
            goal,
            parent,
            task_count=len(goals),
            subagent_id=f"capture-subagent-{index + 1}",
            depth=1,
            model="capture-model",
            session_ref={"session_id": f"{CHILD_SESSION}-{index + 1}"},
        )
        for index, goal in enumerate(goals)
    ]
    for callback, goal in zip(callbacks, goals):
        callback("subagent.start", preview=goal)
    # Success and failure mirror delegate_tool's completion kwargs.
    callbacks[0](
        "subagent.complete",
        preview="Three risk factors changed materially.",
        status="completed",
        duration_seconds=12.5,
        summary="Three risk factors changed materially.",
        input_tokens=1200,
        output_tokens=300,
        reasoning_tokens=0,
        api_calls=3,
        files_read=[],
        files_written=[],
        output_tail=[],
    )
    callbacks[1](
        "subagent.complete",
        preview="Segment data was unavailable.",
        status="failed",
        duration_seconds=4.0,
        summary="Segment data was unavailable.",
    )


def adapter_app(adapter):
    from aiohttp import web

    from gateway.platforms.api_server import cors_middleware, security_headers_middleware

    middlewares = [m for m in (cors_middleware, security_headers_middleware) if m]
    app = web.Application(middlewares=middlewares)
    app["api_server_adapter"] = adapter
    for method, path, handler in adapter._http_route_table():
        app.router.add_route(method, path, handler)
    return app


async def exchange(
    client, method: str, path: str, body: Any = None, *, headers: dict | None = None
) -> dict:
    response = await client.request(
        method,
        path,
        headers=AUTH if headers is None else headers,
        **({} if body is None else {"json": body}),
    )
    request: dict[str, Any] = {"method": method, "path": path}
    if headers is not None:
        request["headers"] = headers
    if body is not None:
        request["json"] = body
    content_type = response.headers.get("Content-Type", "")
    if content_type.startswith("text/event-stream"):
        from gateway.platforms.api_server import _sse_frame

        raw = await response.text()
        frames = [frame for frame in raw.split("\n\n") if frame]
        if "".join(f"{frame}\n\n" for frame in frames) != raw:
            raise RuntimeError(f"Unexpected SSE framing from {path}.")
        parsed = []
        for frame in frames:
            if frame.startswith("data: "):
                data = json.loads(frame[len("data: "):])
                # Normalized frames are re-encoded with Hermes's own writer.
                if _sse_frame(data).decode() != f"{frame}\n\n":
                    raise RuntimeError(f"Hermes SSE encoding changed for {path}.")
                parsed.append({"data": data})
            else:
                parsed.append({"comment": frame})
        return {"request": request, "status": response.status, "sse": parsed}
    return {"request": request, "status": response.status, "body": await response.json()}


async def wait_for(predicate: Callable[[], Any], what: str) -> Any:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + DEADLINE_SECONDS
    while True:
        value = predicate()
        if value:
            return value
        if loop.time() > deadline:
            raise TimeoutError(f"Timed out waiting for {what}.")
        await asyncio.sleep(0.01)


async def wait_status(client, run_id: str, wanted: set[str]) -> dict:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + DEADLINE_SECONDS
    while True:
        result = await exchange(client, "GET", f"/v1/runs/{run_id}")
        if result["body"].get("status") in wanted:
            return result
        if loop.time() > deadline:
            raise TimeoutError(f"Run {run_id} never reached {sorted(wanted)}.")
        await asyncio.sleep(0.01)


async def wait_thread_event(event: threading.Event, what: str) -> None:
    if not await asyncio.to_thread(event.wait, DEADLINE_SECONDS):
        raise TimeoutError(f"Timed out waiting for {what}.")


def new_adapter():
    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter

    return APIServerAdapter(PlatformConfig(enabled=True, extra={"key": API_KEY}))


async def start_run(client, text: str) -> tuple[dict, str]:
    started = await exchange(
        client, "POST", "/v1/runs", {"input": text, "session_id": SESSION}
    )
    return started, started["body"]["run_id"]


async def run_completed() -> dict:
    from aiohttp.test_utils import TestClient, TestServer

    def script(agent):
        callback = agent.tool_progress_callback
        # conversation_loop emits the tag-stripped assistant content this way.
        callback("reasoning.available", "_thinking", "I will check the filing first.", None)
        tool(agent, "terminal", {"command": "python3 fetch_filings.py"}, duration=1.25)
        tool(agent, "web_search", {"query": "ACME 2025 annual report"}, duration=0.5, error=True)
        # Deferred plugin tools are announced under the bridge name.
        bridge = {"name": "pythia_eod_prices", "arguments": {"symbol": "ACME.US"}}
        tool(agent, "tool_call", bridge, duration=0.3)
        from agent.display import build_tool_preview

        delegation = {"tasks": [{"goal": goal} for goal in CHILD_GOALS]}
        callback(
            "tool.started", "delegate_task", build_tool_preview("delegate_task", delegation), delegation
        )
        delegated_children(agent)
        callback("tool.completed", "delegate_task", None, None, duration=16.5, is_error=False)
        agent.stream_delta_callback("The annual report ")
        agent.stream_delta_callback("was filed on 2026-02-01.")
        agent.session_prompt_tokens = 1500
        agent.session_completion_tokens = 250
        agent.session_total_tokens = 1750
        return {
            "final_response": "The annual report was filed on 2026-02-01.",
            "pending_steer": "Also compare it with the prior year.",
        }

    adapter = new_adapter()
    install_agent(adapter, script)
    async with TestClient(TestServer(adapter_app(adapter))) as client:
        started, run_id = await start_run(client, "When was the annual report filed?")
        events = await exchange(client, "GET", f"/v1/runs/{run_id}/events")
        status = await wait_status(client, run_id, {"completed"})
    return {"exchanges": [started, events, status]}


async def run_approval() -> dict:
    from aiohttp.test_utils import TestClient, TestServer

    def script(agent):
        from agent.display import build_tool_preview
        from tools.approval import check_all_command_guards

        args = {"command": "rm -rf ./build"}
        agent.tool_progress_callback(
            "tool.started", "terminal", build_tool_preview("terminal", args), args
        )
        decision = check_all_command_guards(args["command"], "local")
        if not decision.get("approved"):
            raise RuntimeError(f"Capture approval was not granted: {decision}")
        agent.tool_progress_callback(
            "tool.completed", "terminal", None, None, duration=0.2, is_error=False
        )
        return {"final_response": "Removed the build directory."}

    adapter = new_adapter()
    install_agent(adapter, script)
    async with TestClient(TestServer(adapter_app(adapter))) as client:
        started, run_id = await start_run(client, "Clean the build directory.")
        stream = asyncio.create_task(exchange(client, "GET", f"/v1/runs/{run_id}/events"))
        waiting = await wait_status(client, run_id, {"waiting_for_approval"})
        request_id = waiting["body"]["approval"]["request_id"]
        response = await exchange(
            client,
            "POST",
            f"/v1/runs/{run_id}/approval",
            {"choice": "once", "request_id": request_id},
        )
        events = await asyncio.wait_for(stream, DEADLINE_SECONDS)
        status = await wait_status(client, run_id, {"completed"})
    return {"exchanges": [started, waiting, response, events, status]}


async def run_steered() -> dict:
    from aiohttp.test_utils import TestClient, TestServer

    from agent.agent_runtime_helpers import apply_pending_steer_to_tool_results

    delivered: dict[str, Any] = {}

    def script(agent):
        from agent.display import build_tool_preview

        args = {"command": "python3 compare.py"}
        agent.tool_progress_callback(
            "tool.started", "terminal", build_tool_preview("terminal", args), args
        )
        agent.ready.set()
        agent.proceed.wait(DEADLINE_SECONDS)
        messages = [{"role": "tool", "content": '{"output": "done", "exit_code": 0}'}]
        apply_pending_steer_to_tool_results(agent, messages, 1)
        delivered["tool_content"] = messages[0]["content"]
        agent.tool_progress_callback(
            "tool.completed", "terminal", None, None, duration=2.0, is_error=False
        )
        return {"final_response": "Compared 2025 only."}

    adapter = new_adapter()
    created = install_agent(adapter, script)
    async with TestClient(TestServer(adapter_app(adapter))) as client:
        started, run_id = await start_run(client, "Compare the margins.")
        agent = await wait_for(lambda: created and created[0], "the scripted agent")
        await wait_thread_event(agent.ready, "the running tool")
        running = await wait_status(client, run_id, {"running"})
        steer = await exchange(
            client, "POST", f"/v1/runs/{run_id}/steer", {"input": "Focus on 2025 only."}
        )
        agent.proceed.set()
        events = await exchange(client, "GET", f"/v1/runs/{run_id}/events")
        status = await wait_status(client, run_id, {"completed"})
    return {
        "exchanges": [started, running, steer, events, status],
        "delivered_tool_content": delivered["tool_content"],
    }


async def run_failed() -> dict:
    from aiohttp.test_utils import TestClient, TestServer

    def script(agent):
        agent.stream_delta_callback("Looking")
        return {"failed": True, "error": "Error code: 429 - rate limit reached"}

    adapter = new_adapter()
    install_agent(adapter, script)
    async with TestClient(TestServer(adapter_app(adapter))) as client:
        started, run_id = await start_run(client, "Summarize the filing.")
        events = await exchange(client, "GET", f"/v1/runs/{run_id}/events")
        status = await wait_status(client, run_id, {"failed"})
    return {"exchanges": [started, events, status]}


async def run_cancelled() -> dict:
    from aiohttp.test_utils import TestClient, TestServer

    def script(agent):
        agent.stream_delta_callback("Reading the filing")
        agent.ready.set()
        agent.interrupted.wait(DEADLINE_SECONDS)
        return {"final_response": "interrupted", "interrupted": True}

    adapter = new_adapter()
    created = install_agent(adapter, script)
    async with TestClient(TestServer(adapter_app(adapter))) as client:
        started, run_id = await start_run(client, "Read the whole filing.")
        agent = await wait_for(lambda: created and created[0], "the scripted agent")
        await wait_thread_event(agent.ready, "the run to start")
        stop = await exchange(client, "POST", f"/v1/runs/{run_id}/stop", {})
        events = await exchange(client, "GET", f"/v1/runs/{run_id}/events")
        status = await wait_status(client, run_id, {"cancelled"})
    return {"exchanges": [started, stop, events, status]}


async def service() -> dict:
    from aiohttp.test_utils import TestClient, TestServer

    adapter = new_adapter()
    async with TestClient(TestServer(adapter_app(adapter))) as client:
        health = await exchange(client, "GET", "/health")
        capabilities = await exchange(client, "GET", "/v1/capabilities")
        unauthorized = await exchange(client, "GET", "/v1/capabilities", headers={})
        created = await exchange(client, "POST", "/api/sessions", {"title": "Capture chat"})
        duplicate = await exchange(client, "POST", "/api/sessions", {"title": "Capture chat"})
    # /api/model/options is not captured: it fetches remote model catalogs.
    return {"exchanges": [health, capabilities, unauthorized, created, duplicate]}
