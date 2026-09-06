import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import { verifyBasicMemoryReadiness } from "../../scripts/install/basic-memory-readiness.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import {
  installDevice,
  startAndVerify,
} from "../../scripts/install/runtime.mjs";
import { uninstall } from "../../scripts/uninstall/uninstall.mjs";
import { applyMigrations } from "../../scripts/update/migrations.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-packaging-test-"));
  roots.push(root);
  const paths = resolveInstallPaths({
    ...process.env,
    HOME: join(root, "home"),
    PYTHIA_CHECKOUT: repositoryRoot,
    PYTHIA_INSTALL_BIN_HOME: join(root, "bin"),
    PYTHIA_INSTALL_CACHE_HOME: join(root, "cache"),
    PYTHIA_INSTALL_CONFIG_HOME: join(root, "config"),
    PYTHIA_INSTALL_DATA_HOME: join(root, "data"),
    PYTHIA_INSTALL_STATE_HOME: join(root, "state"),
    PYTHIA_INSTALL_SYSTEMD_HOME: join(root, "units"),
  });
  const executables = {
    node: join(paths.runtimeRoot, "node", "22.16.0", "bin", "node"),
    python: join(paths.runtimeRoot, "python", "python3.12"),
    managedPython: join(paths.managedPython, ".venv", "bin", "python"),
    uv: join(paths.runtimeRoot, "uv", "0.9.28", "uv"),
    hermes: join(paths.hermesSource, ".venv", "bin", "hermes"),
    basicMemory: join(paths.managedPython, ".venv", "bin", "basic-memory"),
    next: join(
      repositoryRoot,
      "apps",
      "desk",
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    ),
  };
  return { executables, paths, root };
}

function basicMemoryMarker(paths: ReturnType<typeof resolveInstallPaths>) {
  mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
  atomicWriteJson(join(paths.stateRoot, "basic-memory-project.json"), {
    schema_version: 1,
    project: paths.id,
    path: paths.knowledge,
  });
}

function nativeProject(paths: ReturnType<typeof resolveInstallPaths>) {
  return {
    project_name: paths.id,
    project_path: paths.knowledge,
    available_projects: {
      [paths.id]: {
        path: paths.knowledge,
        active: true,
        is_default: true,
      },
    },
    default_project: paths.id,
    system: { version: "0.23.2" },
    embedding_status: { semantic_search_enabled: false },
  };
}

function basicMemoryFetcher(
  paths: ReturnType<typeof resolveInstallPaths>,
  overrides: {
    project?: Record<string, unknown>;
    config?: Record<string, unknown>;
  } = {},
) {
  const expectedProject = {
    projects: [
      {
        name: paths.id,
        path: paths.knowledge,
        local_path: paths.knowledge,
        source: "local",
        is_default: true,
      },
    ],
    default_project: paths.id,
    constrained_project: paths.id,
    ...overrides.project,
  };
  const config = {
    projects: { [paths.id]: { path: paths.knowledge, mode: "local" } },
    default_project: paths.id,
    database_backend: "sqlite",
    semantic_search_enabled: false,
    ...overrides.config,
  };
  return vi.fn(async (_input: string | URL, init: RequestInit = {}) => {
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init.body));
    if (request.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (request.method === "initialize") {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "Basic Memory", version: "4.0.0b1" },
            capabilities: {},
          },
        },
        { headers: { "mcp-session-id": "test-session" } },
      );
    }
    if (request.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: [
            { name: "list_memory_projects" },
            { name: "search_notes" },
            { name: "basic_memory_diagnostics" },
          ],
        },
      });
    }
    if (request.params?.name === "list_memory_projects") {
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: { isError: false, structuredContent: expectedProject },
      });
    }
    if (request.params?.name === "search_notes") {
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: false,
          structuredContent: {
            results: [],
            current_page: 1,
            page_size: 1,
            total: 0,
            total_is_exact: true,
            has_more: false,
          },
        },
      });
    }
    const diagnostics = `# Basic Memory Diagnostics

## Version
- basic-memory: 0.23.2

## Configuration
- Config path: ${join(paths.basicMemoryConfig, "config.json")}

\`\`\`json
${JSON.stringify(config)}
\`\`\``;
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        isError: false,
        content: [{ type: "text", text: diagnostics }],
      },
    });
  });
}

describe("installed readiness and recovery", () => {
  it("requires Hermes, shared Basic Memory proof, and Desk readiness", async () => {
    const { executables, paths } = fixture();
    mkdirSync(paths.configRoot, { recursive: true, mode: 0o700 });
    atomicWriteJson(join(paths.configRoot, "secrets.json"), {
      schema_version: 1,
      hermes_api_key: "T".repeat(32),
    });
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: string | URL, init: RequestInit = {}) => {
        requests.push({ url: String(input), init });
        if (String(input).endsWith("/api/health")) {
          return Response.json({ service: "pythia-desk", status: "ok" });
        }
        if (String(input).endsWith("/health")) {
          return Response.json({
            status: "ok",
            platform: "hermes-agent",
            version: "0.21.0",
          });
        }
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
      },
    );
    const start = vi.fn(async () => undefined);
    const verifyUnits = vi.fn();
    const verifyMemory = vi.fn();
    const enable = vi.fn();
    await startAndVerify(paths, {
      executables,
      fetch: fetcher,
      start,
      verifyUnits,
      verifyBasicMemoryReadiness: verifyMemory,
      enable,
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(verifyUnits).toHaveBeenCalledTimes(1);
    expect(verifyMemory).toHaveBeenCalledWith(
      paths,
      expect.objectContaining({
        executable: executables.basicMemory,
        fetch: fetcher,
      }),
    );
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8645/health",
      "http://127.0.0.1:8644/api/health",
    ]);
  });

  it("fails closed when the running MCP server serves another project", async () => {
    const { executables, paths } = fixture();
    basicMemoryMarker(paths);
    const fetcher = basicMemoryFetcher(paths, {
      project: { constrained_project: "foreign" },
    });
    await expect(
      verifyBasicMemoryReadiness(paths, {
        executable: executables.basicMemory,
        environment: {},
        fetch: fetcher,
        run: () => JSON.stringify(nativeProject(paths)),
        timeout: 100,
      }),
    ).rejects.toThrow(/stale or foreign project/u);
  });

  it("proves the native project and live MCP text-only path", async () => {
    const { executables, paths } = fixture();
    basicMemoryMarker(paths);
    const fetcher = basicMemoryFetcher(paths);
    await expect(
      verifyBasicMemoryReadiness(paths, {
        executable: executables.basicMemory,
        environment: {},
        fetch: fetcher,
        run: () => JSON.stringify(nativeProject(paths)),
        timeout: 100,
      }),
    ).resolves.toEqual({
      project: paths.id,
      path: resolve(paths.knowledge),
      search: "text",
    });
    const messages = fetcher.mock.calls.flatMap(([, init]) =>
      init?.body ? [JSON.parse(String(init.body))] : [],
    );
    expect(messages.map((message) => message.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "tools/call",
      "tools/call",
    ]);
    expect(messages[4]?.params).toMatchObject({
      name: "search_notes",
      arguments: {
        project: paths.id,
        search_type: "text",
        page: 1,
        page_size: 1,
      },
    });
  });

  it("fails closed when the running MCP server enables semantic search", async () => {
    const { executables, paths } = fixture();
    basicMemoryMarker(paths);
    const fetcher = basicMemoryFetcher(paths, {
      config: { semantic_search_enabled: true },
    });
    await expect(
      verifyBasicMemoryReadiness(paths, {
        executable: executables.basicMemory,
        environment: {},
        fetch: fetcher,
        run: () => JSON.stringify(nativeProject(paths)),
        timeout: 100,
      }),
    ).rejects.toThrow(/search-mode configuration/u);
  });

  it("does not strand install metadata when linger fails after health", async () => {
    const { paths } = fixture();
    const stop = vi.fn(async () => undefined);
    const record = vi.fn();
    await expect(
      installDevice(paths, "preview", {
        expectedRevision: "a".repeat(40),
        prepare: async () => ({ revision: "a".repeat(40) }),
        startAndVerify: async () => undefined,
        ensureLinger: async () => {
          throw new Error("synthetic linger failure");
        },
        recordInstallation: record,
        stop,
        verifySource: async () => undefined,
      }),
    ).rejects.toThrow("synthetic linger failure");
    expect(record).not.toHaveBeenCalled();
    expect(existsSync(paths.installFile)).toBe(false);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        readFileSync(join(paths.transactionRoot, "active.json"), "utf8"),
      ),
    ).toMatchObject({ phase: "failed-stopped", services: "stopped" });
  });

  it("recovers a crash after the installation marker is recorded", async () => {
    const { paths } = fixture();
    const revision = "b".repeat(40);
    const start = vi.fn(async () => undefined);
    const linger = vi.fn(async () => ({ enabled: true, changed: false }));
    const stop = vi.fn(async () => undefined);
    await expect(
      installDevice(paths, "preview", {
        expectedRevision: revision,
        prepare: async () => ({ revision }),
        startAndVerify: start,
        ensureLinger: linger,
        stop,
        verifySource: async () => undefined,
        afterRecord: async () => {
          throw new Error("synthetic process crash after marker");
        },
      }),
    ).rejects.toThrow("synthetic process crash after marker");
    expect(JSON.parse(readFileSync(paths.installFile, "utf8"))).toMatchObject({
      revision,
      channel: "preview",
    });
    expect(
      JSON.parse(
        readFileSync(join(paths.transactionRoot, "active.json"), "utf8"),
      ),
    ).toMatchObject({ phase: "failed-stopped", services: "stopped" });

    const recovered = await installDevice(paths, "preview", {
      expectedRevision: revision,
      prepare: async () => {
        throw new Error("recovery must not prepare again");
      },
      startAndVerify: start,
      ensureLinger: linger,
      stop,
      verifySource: async () => undefined,
    });
    expect(recovered).toMatchObject({ recovered: true, revision });
    expect(
      JSON.parse(
        readFileSync(join(paths.transactionRoot, "active.json"), "utf8"),
      ),
    ).toMatchObject({ phase: "complete", services: "running" });
  });

  it("applies the versioned device-state migration exactly once", () => {
    const { paths } = fixture();
    for (const path of [paths.configRoot, paths.stateRoot, paths.dataRoot]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    expect(applyMigrations(paths)).toEqual(["0001-device-state-v1"]);
    expect(applyMigrations(paths)).toEqual(["0001-device-state-v1"]);
    const ledger = JSON.parse(
      readFileSync(join(paths.stateRoot, "migrations.json"), "utf8"),
    );
    expect(ledger.applied).toEqual(["0001-device-state-v1"]);
  });

  it("uninstalls managed files, retains user data, and makes reinstall possible", () => {
    const { paths } = fixture();
    for (const path of [
      paths.configRoot,
      paths.stateRoot,
      paths.runtimeRoot,
      paths.cacheRoot,
      paths.knowledge,
      paths.binRoot,
    ]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    writeFileSync(paths.installedCommand, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(paths.knowledge, "case.md"), "Investor-owned\n");
    atomicWriteJson(paths.installFile, {
      schema_version: 1,
      checkout: paths.checkout,
      revision: "a".repeat(40),
    });
    const actions = {
      stop: () => undefined,
      disable: () => undefined,
      unitState: () => "inactive",
      enablement: () => "disabled",
      removeUnits: () => undefined,
      reload: () => undefined,
    };
    const result = uninstall(paths, { actions });
    expect(result.knowledge_deleted).toBe(false);
    expect(existsSync(paths.installedCommand)).toBe(false);
    expect(existsSync(paths.runtimeRoot)).toBe(false);
    expect(existsSync(paths.installFile)).toBe(false);
    expect(readFileSync(join(paths.knowledge, "case.md"), "utf8")).toContain(
      "Investor-owned",
    );
    expect(existsSync(paths.configRoot)).toBe(true);
  });

  it("purges config, state, and cache but retains authoritative Markdown", () => {
    const { paths } = fixture();
    for (const path of [
      paths.configRoot,
      paths.stateRoot,
      paths.cacheRoot,
      paths.knowledge,
    ]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    writeFileSync(join(paths.knowledge, "case.md"), "Keep me\n");
    const result = uninstall(paths, {
      purge: true,
      actions: {
        stop: () => undefined,
        disable: () => undefined,
        unitState: () => "absent",
        enablement: () => "not-found",
        removeUnits: () => undefined,
        reload: () => undefined,
      },
    });
    expect(result.purged_device_configuration).toBe(true);
    expect(result.knowledge_deleted).toBe(false);
    expect(existsSync(paths.configRoot)).toBe(false);
    expect(existsSync(paths.stateRoot)).toBe(false);
    expect(existsSync(paths.cacheRoot)).toBe(false);
    expect(readFileSync(join(paths.knowledge, "case.md"), "utf8")).toBe(
      "Keep me\n",
    );
  });
});
