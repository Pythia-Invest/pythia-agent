import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import { verifyBasicMemoryReadiness } from "../../scripts/install/basic-memory-readiness.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import {
  buildManagedSource,
  installDevice,
  startAndVerify,
} from "../../scripts/install/runtime.mjs";
import {
  renderUnits,
  installUnits,
  removeUnits,
  serviceAction,
  serviceEnvironments,
  serviceEnvironmentValues,
  UNIT_NAMES,
  verifyOwnedUnits,
  writeServiceEnvironment,
} from "../../scripts/install/systemd.mjs";
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

describe("installed packaging", () => {
  it("accepts only Ubuntu x86-64 with the qualified Git baseline", () => {
    const { root } = fixture();
    const ubuntu = join(root, "ubuntu-release");
    const debian = join(root, "debian-release");
    writeFileSync(ubuntu, "ID=ubuntu\n");
    writeFileSync(debian, "ID=debian\n");
    const command = join(repositoryRoot, "scripts", "install", "platform.sh");
    expect(() =>
      execFileSync(command, [ubuntu, "Linux", "x86_64", "2.43.0"]),
    ).not.toThrow();
    expect(() =>
      execFileSync(command, [debian, "Linux", "x86_64", "2.43.0"]),
    ).toThrow();
    expect(() =>
      execFileSync(command, [ubuntu, "Linux", "aarch64", "2.43.0"]),
    ).toThrow();
    expect(() =>
      execFileSync(command, [ubuntu, "Linux", "x86_64", "2.42.9"]),
    ).toThrow();
  });

  it("accepts uv commit metadata but still requires the exact pinned version", () => {
    const installer = readFileSync(join(repositoryRoot, "install.sh"), "utf8");
    const parser = installer.match(/-p '([^']+)' "\$uv_version_json"/u)?.[1];
    const expected = installer.match(/\[ "\$uv_version" = '([^']+)' \]/u)?.[1];
    expect(parser).toBe("JSON.parse(process.argv[1]).version");
    expect(expected).toBe("0.9.28");

    const version = (value: string) =>
      execFileSync(process.execPath, ["-p", parser ?? "", value], {
        encoding: "utf8",
      }).trim();
    expect(
      version(
        JSON.stringify({
          package_name: "uv",
          version: "0.9.28",
          commit_info: {
            short_commit_hash: "0e1351e40",
            commit_date: "2026-01-29",
          },
        }),
      ),
    ).toBe(expected);
    expect(
      version(JSON.stringify({ package_name: "uv", version: "0.9.29" })),
    ).not.toBe(expected);
    expect(installer).toContain("self version --output-format json");
    expect(installer).not.toContain("$uv_root/uv --version)\" = 'uv 0.9.28'");
  });

  it("renders only the four loopback runtime units without host mutation", () => {
    const { executables, paths } = fixture();
    const units = renderUnits(paths, executables);
    expect(Object.keys(units).sort()).toEqual([...UNIT_NAMES].sort());
    const text = Object.values(units).join("\n");
    expect(text).toContain("127.0.0.1");
    expect(text).toContain("gateway run --external-supervisor");
    expect(text).not.toContain("Design Lab");
    expect(UNIT_NAMES).not.toContain("pythia-desk.service");
    expect(UNIT_NAMES).not.toContain("pythia.target");
    expect(text).not.toContain("pythia-desk.service");
    expect(paths.ports.hermes).toBe(8645);
    expect(text).not.toContain(".agents");
    expect(text).toContain(
      "UnsetEnvironment=API_SERVER_KEY EODHD_API_TOKEN EDGAR_IDENTITY",
    );
    expect(text).not.toContain("PRIVATE_BEARER");
    const hermesUnit = units["pythia-agent-hermes.service"] ?? "";
    expect(hermesUnit).toContain(`WorkingDirectory="${paths.workspace}"`);
    expect(hermesUnit).not.toContain(`WorkingDirectory="${paths.checkout}"`);
    const deskUnit = units["pythia-agent-desk.service"] ?? "";
    expect(deskUnit).toContain(
      `WorkingDirectory="${join(paths.checkout, "apps", "desk")}"`,
    );
    expect(deskUnit).not.toContain(`WorkingDirectory="${paths.checkout}"`);
    expect(deskUnit).not.toContain(".agents");
  });

  it("performs only the Desk build after shared runtime preparation", () => {
    const { executables, paths } = fixture();
    const commands: Array<{ command: string; args: string[]; path: string }> =
      [];
    buildManagedSource(paths, executables, {
      runCommand: (
        command: string,
        args: string[],
        options: { environment: NodeJS.ProcessEnv },
      ) => {
        commands.push({ command, args, path: options.environment.PATH ?? "" });
      },
    });
    expect(commands).toEqual([
      {
        command: "pnpm",
        args: ["--filter", "@pythia/desk", "build"],
        path: expect.stringMatching(
          new RegExp(`^${dirname(executables.node)}`),
        ),
      },
    ]);
  });

  it("suspends boot before stop and never dispatches a foreign lab unit", () => {
    const calls: string[][] = [];
    const systemctl = vi.fn((args: string[]) => {
      calls.push(args);
      if (args[0] === "is-enabled") return "disabled";
      if (args[0] === "is-active") return "inactive";
      return "";
    });
    serviceAction("stop", { systemctl });
    expect(calls.slice(0, 3)).toEqual([
      ["disable", "pythia-agent.target"],
      ["is-enabled", "pythia-agent.target"],
      ["stop", "pythia-agent.target"],
    ]);
    expect(calls.map((args) => args.join(" ")).join("\n")).not.toMatch(
      /(^|\s)pythia-(desk|hermes|basic-memory)\.service($|\s)|(^|\s)pythia\.target($|\s)/u,
    );
  });

  it("installs and removes only the public-product units", () => {
    const { executables, paths } = fixture();
    mkdirSync(paths.unitRoot, { recursive: true, mode: 0o700 });
    const foreign = join(paths.unitRoot, "pythia-desk.service");
    writeFileSync(foreign, "[Unit]\nDescription=existing lab\n");
    installUnits(paths, renderUnits(paths, executables));
    removeUnits(paths);
    expect(readFileSync(foreign, "utf8")).toContain("existing lab");
    for (const name of UNIT_NAMES) {
      expect(existsSync(join(paths.unitRoot, name))).toBe(false);
    }
  });

  it("does not accept a residual failed unit as a confirmed stop", () => {
    expect(() =>
      serviceAction("stop", {
        systemctl: (args: string[]) => {
          if (args[0] === "is-enabled") return "disabled";
          if (args[0] === "is-active") {
            return args[1] === "pythia-agent-hermes.service"
              ? "failed"
              : "inactive";
          }
          return "";
        },
      }),
    ).toThrow("did not stop");
  });

  it("keeps the bearer in secrets.json and out of every persistent service environment", () => {
    const { executables, paths } = fixture();
    const secret = "PRIVATE_BEARER";
    mkdirSync(paths.configRoot, { recursive: true, mode: 0o700 });
    atomicWriteJson(join(paths.configRoot, "secrets.json"), {
      schema_version: 1,
      hermes_api_key: secret,
    });
    writeFileSync(paths.serviceEnvironment, `API_SERVER_KEY="${secret}"\n`, {
      mode: 0o600,
    });
    writeServiceEnvironment(paths, secret, executables);
    const environments = serviceEnvironments(paths, executables);
    expect(JSON.stringify(environments)).not.toContain(secret);
    expect(JSON.stringify(environments)).not.toContain("API_SERVER_KEY");
    expect(environments.basicMemory).toContain(
      'BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED="false"',
    );
    expect(environments.desk).toContain('NEXT_TELEMETRY_DISABLED="1"');
    expect(environments.hermes).toContain('HERMES_DISABLE_LAZY_INSTALLS="1"');
    expect(environments.desk).toContain(
      `PYTHIA_LIFECYCLE_COMMAND="${paths.installedCommand}"`,
    );
    expect(environments.hermes).toContain(
      `PYTHIA_PYTHON="${executables.managedPython}"`,
    );
    expect(environments.desk).toContain(
      `PYTHIA_INSTALL_CONFIG_HOME="${resolve(paths.configRoot, "..")}"`,
    );
    expect(
      Object.keys(serviceEnvironmentValues(paths, executables).basicMemory),
    ).toEqual([
      "HOME",
      "BASIC_MEMORY_CONFIG_DIR",
      "BASIC_MEMORY_NO_PROMOS",
      "BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED",
      "FASTMCP_CHECK_FOR_UPDATES",
      "FASTMCP_SHOW_SERVER_BANNER",
      "HF_HOME",
      "FASTEMBED_CACHE_PATH",
      "XDG_CACHE_HOME",
      "PATH",
    ]);
    expect(existsSync(paths.serviceEnvironment)).toBe(false);
    expect(
      readFileSync(join(paths.configRoot, "secrets.json"), "utf8"),
    ).toContain(secret);
    for (const path of Object.values(paths.serviceEnvironments)) {
      expect(readFileSync(path, "utf8")).not.toContain(secret);
    }
  });

  it("verifies the exact active owned units without mutating the host", () => {
    const { executables, paths } = fixture();
    const units = renderUnits(paths, executables);
    const commands = {
      "pythia-agent-basic-memory.service": [
        executables.basicMemory,
        "mcp --transport streamable-http --host 127.0.0.1 --port 8643 --path /mcp --project production",
      ],
      "pythia-agent-hermes.service": [
        executables.python,
        `${paths.serviceLauncher} hermes ${executables.hermes} -p pythia gateway run --external-supervisor`,
      ],
      "pythia-agent-desk.service": [
        executables.python,
        `${paths.serviceLauncher} desk ${executables.node} ${executables.next} start --hostname 127.0.0.1 --port 8644`,
      ],
    } as const;
    const systemctl = vi.fn((args: string[]) => {
      if (args[0] === "is-enabled") return "enabled";
      if (args[0] === "is-active") return "active";
      const name = args[1] as keyof typeof commands | "pythia-agent.target";
      const property = args[2];
      if (property === "--property=FragmentPath") {
        return join(paths.unitRoot, name);
      }
      if (property === "--property=MainPID") return "1234";
      const command = commands[name as keyof typeof commands];
      return `{ path=${command[0]} ; argv[]=${command.join(" ")} ; ignore_errors=no ; }`;
    });
    expect(
      verifyOwnedUnits(paths, executables, {
        systemctl,
        readFile: (path: string) => units[path.split("/").at(-1) ?? ""],
      }),
    ).toMatchObject({ owned: true, units: expect.arrayContaining(UNIT_NAMES) });
  });

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
