import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import {
  CONTEXT_FAIL_TOOLSET,
  CONTEXT_PASS_TOOLSET,
  CONTEXT_TOOL,
  exactExecutable,
  exactRegularFile,
  run,
  sha256,
} from "./assembled-cache.mjs";
import {
  fixture,
  qualificationProcessEnvironment,
} from "./assembled-fixture.mjs";

export function requestJson({
  port,
  path,
  method = "GET",
  headers = {},
  body,
  timeoutMs = 5_000,
}) {
  return new Promise((resolvePromise, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path, method, headers },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch (error) {
            reject(error);
            return;
          }
          if ((response.statusCode ?? 500) >= 400) {
            reject(
              new Error(
                `${method} ${path} returned ${response.statusCode}: ${text}`,
              ),
            );
            return;
          }
          resolvePromise({
            body: parsed,
            headers: response.headers,
            status: response.statusCode,
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error(`${method} ${path} timed out.`)),
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export function privateStateDigests(stack) {
  const candidates = {
    profile_config: join(stack.paths.profileRoot, "config.yaml"),
    root_auth: join(stack.paths.hermesRoot, "auth.json"),
    secrets: join(stack.paths.configRoot, "secrets.json"),
    workspace_context: join(stack.paths.workspace, "AGENTS.md"),
    workspace_note: join(stack.paths.workspace, "qualification-note.md"),
    knowledge_note: join(stack.paths.knowledge, "qualification-note.md"),
  };
  return Object.fromEntries(
    Object.entries(candidates).map(([name, path]) => [
      name,
      existsSync(path) ? sha256(path) : null,
    ]),
  );
}

const NATIVE_SESSION_SCRIPT = `
import json
import sys
from pathlib import Path
from hermes_state import SessionDB

mode, session_id, workspace = sys.argv[1:]
db = SessionDB(Path.cwd() / "state.db")
try:
    if mode == "seed":
        result = db.import_sessions([{
            "id": session_id,
            "source": "cli",
            "title": "Pythia T08 synthetic native session",
            "cwd": workspace,
            "git_repo_root": workspace,
            "messages": [{
                "role": "user",
                "content": "Provider-free synthetic native session state",
            }],
        }])
        if not result.get("ok"):
            raise RuntimeError(f"native session import failed: {result}")
    session = db.export_session(session_id)
    if session is None:
        raise RuntimeError(f"native session {session_id!r} is missing")
    selected = {
        "id": session["id"],
        "source": session["source"],
        "title": session["title"],
        "cwd": session["cwd"],
        "git_repo_root": session["git_repo_root"],
        "messages": [
            {"role": item["role"], "content": item["content"]}
            for item in session.get("messages", [])
        ],
    }
    print(json.dumps(selected, sort_keys=True))
finally:
    db.close()
`;

function nativeSession(stack, mode) {
  const python = join(stack.paths.hermesSource, ".venv/bin/python");
  exactExecutable(python);
  mkdirSync(stack.paths.profileRoot, { recursive: true, mode: 0o700 });
  const selected = JSON.parse(
    run(
      python,
      [
        "-c",
        NATIVE_SESSION_SCRIPT,
        mode,
        stack.native_session_id,
        stack.paths.workspace,
      ],
      {
        cwd: stack.paths.profileRoot,
        environment: {
          ...qualificationProcessEnvironment(stack),
          HERMES_HOME: stack.paths.profileRoot,
          PYTHONPATH: stack.paths.hermesSource,
        },
      },
    ),
  );
  return {
    id: stack.native_session_id,
    selected,
    sha256: createHash("sha256").update(JSON.stringify(selected)).digest("hex"),
    store: join(stack.paths.profileRoot, "state.db"),
  };
}

export function seedNativeSession(rootValue, stackName = "one") {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  return {
    native_session: nativeSession(stack, "seed"),
    provider_or_model_call: false,
    stack: stackName,
  };
}

export async function deskSession(stack) {
  const origin = `http://127.0.0.1:${stack.ports.desk}`;
  const common = { Host: `127.0.0.1:${stack.ports.desk}`, Origin: origin };
  const bootstrap = await requestJson({
    port: stack.ports.desk,
    path: "/api/browser-session",
    headers: common,
  });
  const csrf = bootstrap.body.csrf_token;
  const rawCookie = bootstrap.headers["set-cookie"]?.[0] ?? "";
  const cookie = rawCookie.split(";", 1)[0];
  if (!csrf || !cookie)
    throw new Error("Desk did not issue its browser session and CSRF token.");
  return { common, cookie, csrf };
}

export async function observeAssembledStack(rootValue, stackName = "one") {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  const secretsPath = join(stack.paths.configRoot, "secrets.json");
  exactRegularFile(secretsPath);
  const apiKey = JSON.parse(readFileSync(secretsPath, "utf8")).hermes_api_key;
  if (typeof apiKey !== "string" || apiKey.length < 16) {
    throw new Error(
      "Synthetic Hermes API key is missing from the qualification owner.",
    );
  }
  const toolsets = await requestJson({
    port: stack.ports.hermes,
    path: "/v1/toolsets",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const skills = await requestJson({
    port: stack.ports.hermes,
    path: "/v1/skills",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const session = await deskSession(stack);
  const settings = await requestJson({
    port: stack.ports.desk,
    path: "/api/settings",
    headers: { ...session.common, Cookie: session.cookie },
  });
  const rows = toolsets.body.data ?? [];
  return {
    context_probe_failed: rows.some(
      (row) =>
        row.name === CONTEXT_FAIL_TOOLSET && row.tools?.includes(CONTEXT_TOOL),
    ),
    context_probe_passed: rows.some(
      (row) =>
        row.name === CONTEXT_PASS_TOOLSET && row.tools?.includes(CONTEXT_TOOL),
    ),
    desk_admission: "normal-loopback-origin-cookie",
    native_skills: (skills.body.data ?? []).map((entry) => entry.name).sort(),
    native_session: nativeSession(stack, "read"),
    private_state_sha256: privateStateDigests(stack),
    provider_or_model_call: false,
    runtime_generation: JSON.parse(readFileSync(stack.paths.receipt, "utf8"))
      .runtime_generation,
    settings: {
      basic_memory: settings.body.basic_memory,
      skills: settings.body.skills,
      toolsets: settings.body.toolsets,
    },
    stack: stackName,
  };
}
