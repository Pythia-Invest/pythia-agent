"""Opt-in live eval of the agent's tool surface: asks a running Desk each question and saves what the agent did.

It uses the investor's configured model and connected sources, so it costs tokens and never runs in CI. Run it on
tool-surface changes and before a Hermes upgrade, once with Tool Search on and once off
(`hermes config set tools.tool_search.enabled on|off` on the profile the Desk uses, then restart Hermes).

Usage: python3 tooling/agent-eval/run.py DESK_URL [QUESTION_ID ...]
Each transcript goes to .local/agent-eval/<UTC time>/<id>.json; grade the answers by hand against questions.json.
"""
import http.cookiejar
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROVIDER_PREFIXES = ("pythia_", "sec_", "esef_", "gleif_", "eodhd_", "yahoo_", "coinmarketcap_", "openfigi_",
                     "hyperliquid_")
base, wanted = sys.argv[1].rstrip("/"), set(sys.argv[2:])
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(path, body=None, token=None):
    headers = {"Origin": base, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["X-Pythia-CSRF"] = token
    data = None if body is None else json.dumps(body).encode()
    with opener.open(urllib.request.Request(base + path, data=data, headers=headers), timeout=60) as response:
        return json.loads(response.read() or b"{}")


def called(messages):
    """Tool names in call order; a Tool Search `tool_call` counts as the tool it ran."""
    names = []
    for message in messages:
        for item in message.get("tool_calls") or []:
            function = item.get("function", item)
            name, arguments = function.get("name"), function.get("arguments")
            if name == "tool_call":
                name = (json.loads(arguments) if isinstance(arguments, str) else arguments or {}).get("name", "?")
            names.append(name)
    return names


out = Path.cwd() / ".local/agent-eval" / time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
out.mkdir(parents=True)
for question in json.loads((HERE / "questions.json").read_text())["questions"]:
    if wanted and question["id"] not in wanted:
        continue
    token = call("/api/browser-session")["csrf_token"]
    session = call("/api/sessions", {"title": "eval " + question["id"]}, token)["session"]["id"]
    started = time.time()
    run = call("/api/runs", {"session_id": session, "input": question["question"]}, token)["run_id"]
    while (state := call("/api/runs/" + run, token=token)).get("status") in ("queued", "started", "running",
                                                                              "in_progress", "stopping"):
        time.sleep(4)
    messages = call(f"/api/sessions/{session}/messages?limit=200", token=token)["data"]
    messages.sort(key=lambda message: message.get("timestamp") or 0)
    names = called(messages)
    record = {**question, "session_id": session, "status": state.get("status"), "usage": state.get("usage"),
              "latency_s": round(time.time() - started, 1), "calls": names, "messages": messages}
    (out / f"{question['id']}.json").write_text(json.dumps(record, indent=1, ensure_ascii=False))
    print(f"{question['id']} {record['status']} {record['latency_s']}s  pythia {sum(n.startswith(PROVIDER_PREFIXES) for n in names)}"
          f"/{len(names)} calls  web {sum(n in ('web_search', 'web_extract') for n in names)}  "
          f"input tokens {(record['usage'] or {}).get('input_tokens', 0):,}  first {next((n for n in names if n.startswith(PROVIDER_PREFIXES)), '-')}")
print("Transcripts:", out)
