import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson } from "./files.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const EXPECTED_VERSION = "0.23.2";
const MAX_RESPONSE_BYTES = 1024 * 1024;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.environment,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}${detail ? `:\n${detail}` : ""}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

function expectedProject(paths) {
  return { name: paths.id, path: resolve(paths.knowledge) };
}

export function verifyBasicMemoryMarker(paths) {
  const marker = join(paths.stateRoot, "basic-memory-project.json");
  if (!existsSync(marker)) {
    throw new Error(
      `Basic Memory's Pythia project receipt is missing: ${marker}`,
    );
  }
  const value = readJson(marker);
  const expected = expectedProject(paths);
  if (
    value.schema_version !== 1 ||
    value.project !== expected.name ||
    typeof value.path !== "string" ||
    resolve(value.path) !== expected.path
  ) {
    throw new Error(
      "Basic Memory's Pythia project receipt is stale or foreign.",
    );
  }
  return expected;
}

export function verifyBasicMemoryNativeProject(
  paths,
  executable,
  environment,
  options = {},
) {
  const invoke = options.run ?? run;
  const expected = expectedProject(paths);
  const output = invoke(
    executable,
    ["project", "info", expected.name, "--json", "--local"],
    { cwd: paths.workspace, environment, timeout: 30_000 },
  );
  let project;
  try {
    project = JSON.parse(output);
  } catch {
    throw new Error(
      "Basic Memory returned invalid native project information.",
    );
  }
  const mapped = project.available_projects?.[expected.name];
  if (
    project.project_name !== expected.name ||
    typeof project.project_path !== "string" ||
    resolve(project.project_path) !== expected.path ||
    project.default_project !== expected.name ||
    typeof mapped?.path !== "string" ||
    resolve(mapped.path) !== expected.path ||
    mapped.is_default !== true ||
    project.system?.version !== EXPECTED_VERSION ||
    project.embedding_status?.semantic_search_enabled !== false
  ) {
    throw new Error(
      "Basic Memory's native project mapping, version, or text-only mode does not match Pythia.",
    );
  }
  return expected;
}

async function readBoundedText(response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("Basic Memory MCP returned an oversized response.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Basic Memory MCP returned an oversized response.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function responseMessages(text, contentType) {
  if (contentType.includes("application/json")) {
    try {
      return [JSON.parse(text)];
    } catch {
      throw new Error("Basic Memory MCP returned invalid JSON.");
    }
  }
  if (!contentType.includes("text/event-stream")) {
    throw new Error("Basic Memory MCP returned an unexpected content type.");
  }
  const messages = [];
  for (const event of text.split(/\r?\n\r?\n/u)) {
    const data = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      throw new Error("Basic Memory MCP returned invalid event data.");
    }
  }
  return messages;
}

export async function mcpPost(fetcher, url, message, sessionId, options = {}) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = PROTOCOL_VERSION;
  }
  const response = await fetcher(url, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(options.requestTimeout ?? 2_000),
  });
  if (!response.ok) {
    throw new Error(`Basic Memory MCP returned HTTP ${response.status}.`);
  }
  if (message.id === undefined) return { response, result: null };
  const contentType = response.headers.get("content-type") ?? "";
  const messages = responseMessages(
    await readBoundedText(response),
    contentType.toLowerCase(),
  );
  const reply = messages.find((candidate) => candidate?.id === message.id);
  if (reply?.jsonrpc !== "2.0") {
    throw new Error("Basic Memory MCP did not return the requested response.");
  }
  if (reply.error) {
    throw new Error(
      `Basic Memory MCP request failed: ${reply.error.message ?? "unknown JSON-RPC error"}.`,
    );
  }
  if (!reply.result || typeof reply.result !== "object") {
    throw new Error("Basic Memory MCP returned an invalid result.");
  }
  return { response, result: reply.result };
}

function toolValue(result) {
  const structured = result?.structuredContent;
  if (!structured || typeof structured !== "object") return null;
  return structured.result && typeof structured.result === "object"
    ? structured.result
    : structured;
}

function toolText(result) {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function assertToolSuccess(result, name) {
  if (result?.isError === true) {
    throw new Error(`Basic Memory MCP ${name} readiness call failed.`);
  }
}

export function assertMcpProject(paths, result) {
  assertToolSuccess(result, "list_memory_projects");
  const value = toolValue(result);
  const expected = expectedProject(paths);
  const project = value?.projects?.find(
    (entry) => entry?.name === expected.name,
  );
  const projectPath = project?.local_path || project?.path;
  if (
    value?.constrained_project !== expected.name ||
    value?.default_project !== expected.name ||
    typeof projectPath !== "string" ||
    resolve(projectPath) !== expected.path ||
    project?.is_default !== true ||
    project?.source !== "local"
  ) {
    throw new Error(
      "The running Basic Memory MCP server is constrained to a stale or foreign project.",
    );
  }
}

export function assertTextSearch(result) {
  assertToolSuccess(result, "search_notes");
  const value = toolValue(result);
  if (
    !value ||
    !Array.isArray(value.results) ||
    value.current_page !== 1 ||
    value.page_size !== 1 ||
    typeof value.total !== "number"
  ) {
    throw new Error(
      "Basic Memory MCP did not complete the bounded text search.",
    );
  }
}

export function assertMcpDiagnostics(paths, result) {
  assertToolSuccess(result, "basic_memory_diagnostics");
  const text = toolText(result);
  const configMatch = text.match(/```json\s*([\s\S]*?)\s*```/u);
  let config;
  try {
    config = JSON.parse(configMatch?.[1] ?? "");
  } catch {
    throw new Error("Basic Memory MCP returned invalid native diagnostics.");
  }
  const expected = expectedProject(paths);
  const expectedConfig = resolve(join(paths.basicMemoryConfig, "config.json"));
  const reportedPath = text.match(/^- Config path:\s*(.+)$/mu)?.[1]?.trim();
  const mapped = config.projects?.[expected.name];
  if (
    !reportedPath ||
    resolve(reportedPath) !== expectedConfig ||
    !text.includes(`- basic-memory: ${EXPECTED_VERSION}`) ||
    config.default_project !== expected.name ||
    typeof mapped?.path !== "string" ||
    resolve(mapped.path) !== expected.path ||
    mapped.mode !== "local" ||
    config.database_backend !== "sqlite" ||
    config.semantic_search_enabled !== false
  ) {
    throw new Error(
      "The running Basic Memory MCP server has a stale project or search-mode configuration.",
    );
  }
}

export function childExited(child) {
  return child && (child.exitCode !== null || child.signalCode !== null);
}

export async function initializeMcp(paths, child, fetcher, timeout) {
  const url = `http://127.0.0.1:${paths.ports.memory}/mcp`;
  const deadline = Date.now() + timeout;
  let last = "not listening";
  while (Date.now() < deadline) {
    if (childExited(child)) {
      throw new Error(
        `Basic Memory exited before readiness (${child.signalCode ?? `exit ${child.exitCode}`}).`,
      );
    }
    try {
      const initialized = await mcpPost(
        fetcher,
        url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "pythia-readiness", version: "0.1" },
          },
        },
        null,
      );
      if (
        initialized.result.protocolVersion !== PROTOCOL_VERSION ||
        initialized.result.serverInfo?.name !== "Basic Memory"
      ) {
        throw new Error(
          "The MCP listener is not the expected Basic Memory server.",
        );
      }
      const sessionId = initialized.response.headers.get("mcp-session-id");
      if (!sessionId) {
        throw new Error("Basic Memory MCP did not establish an owned session.");
      }
      return { url, sessionId };
    } catch (error) {
      if (
        error instanceof Error &&
        /not the expected|did not establish|invalid|unexpected|requested response/u.test(
          error.message,
        )
      ) {
        throw error;
      }
      last = error instanceof Error ? error.message : "request failed";
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Basic Memory MCP did not become ready: ${last}`);
}
