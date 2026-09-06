import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  redactedEnvironment,
  runtimeEnvironment,
} from "../../scripts/dev/environment.mjs";
import {
  MANAGED_PLUGIN_FILES,
  MANAGED_PYTHON_SOURCE_FILES,
  ensurePrivateDirectory,
  ensurePrivateTree,
  refreshManagedPlugin,
  refreshManagedPythonSource,
  atomicWriteJson,
  readJson,
} from "../../scripts/dev/files.mjs";
import { resolveStackPaths, stackIdentity } from "../../scripts/dev/paths.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import {
  assertHermesRuntimePath,
  authenticationStatus,
  developmentPrivateRoots,
  ensureHermesSource,
  ensureNativeWorkspaceCwd,
  inheritModelDefaults,
  installSeeds,
  nativeRootAuthArguments,
  prepareManagedRuntime,
  recoverInterruptedProfileInitialization,
  refreshRuntimeAssets,
  runtimeCommands,
} from "../../scripts/dev/runtime.mjs";
import {
  initializeDevelopmentRuntime,
  recoverDevelopmentInitialization,
  resetDerivedDevelopmentState,
  developmentServices,
  requestHermesRestart,
  requestRuntimeRefresh,
  runDevelopment,
  supervise,
  stackStatus,
  stopStack,
  validateReceipt,
  waitForNoReuseAddressPortRelease,
} from "../../scripts/dev/supervisor.mjs";
import { verifyBasicMemoryNativeProject } from "../../scripts/install/basic-memory-readiness.mjs";
import { copySourceSnapshot } from "../../tooling/source-snapshot.mjs";

const repositoryRoot = new URL("../../", import.meta.url).pathname.replace(
  /\/$/u,
  "",
);
const temporaryRoots: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "pythia-dev-test-"));
  temporaryRoots.push(root);
  return root;
}

function environment(root: string, repo?: string) {
  const checkout = repo ?? join(root, "checkout");
  // Port identity follows the checkout, not XDG roots. Give each fixture its
  // own source path so running tests never claims an open developer stack.
  if (repo === undefined && !existsSync(checkout))
    copySourceSnapshot(repositoryRoot, checkout);
  return {
    ...process.env,
    PYTHIA_DEV_REPO_ROOT: checkout,
    PYTHIA_DEV_CONFIG_HOME: join(root, "config"),
    PYTHIA_DEV_STATE_HOME: join(root, "state"),
    PYTHIA_DEV_DATA_HOME: join(root, "data"),
    PYTHIA_DEV_CACHE_HOME: join(root, "cache"),
  };
}

async function waitUntil(check: () => boolean, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Timed out waiting for fixture state");
}

async function startFixture(root: string, extra: Record<string, string> = {}) {
  const env = {
    ...environment(root),
    PYTHIA_TEST_FIXTURE_ROOT: repositoryRoot,
    ...extra,
  };
  const paths = resolveStackPaths({ environment: env });
  mkdirSync(paths.processRoot, { recursive: true, mode: 0o700 });
  mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    [join(repositoryRoot, "scripts/dev/test/fixture-supervisor.mjs")],
    { cwd: repositoryRoot, env, stdio: "ignore" },
  );
  children.push(child);
  return { child, env, paths };
}

async function runLifecycleCli(
  env: NodeJS.ProcessEnv,
  command: string,
  argument?: string,
) {
  const child = spawn(
    process.execPath,
    [
      join(repositoryRoot, "scripts", "dev", "cli.mjs"),
      command,
      ...(argument ? [argument] : []),
    ],
    {
      cwd: repositoryRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });
  return { code, stderr, stdout };
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("worktree identity and native command construction", () => {
  it("observes native root auth status without initializing or writing secrets", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(join(paths.hermesSource, ".venv", "bin"), {
      recursive: true,
    });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    const hermes = runtimeCommands(paths).hermes;
    writeFileSync(hermes, "#!/bin/sh\nprintf '%s\\n' \"$HERMES_HOME|$*\"\n");
    chmodSync(hermes, 0o700);
    atomicWriteJson(paths.runtimeReceipt, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
    });

    await expect(authenticationStatus(paths, "openai-codex")).resolves.toBe(
      `${paths.hermesRoot}|-p default auth status openai-codex`,
    );
    expect(existsSync(join(paths.configRoot, "secrets.json"))).toBe(false);

    rmSync(paths.runtimeReceipt);
    await expect(authenticationStatus(paths, "openai-codex")).rejects.toThrow(
      /just dev-init/u,
    );
    expect(existsSync(join(paths.configRoot, "secrets.json"))).toBe(false);
  });

  it("gives two worktree paths independent state, profiles, and ports", () => {
    const base = temporaryRoot();
    const first = join(base, "first");
    const second = join(base, "second");
    mkdirSync(first);
    mkdirSync(second);
    const shared = environment(base, first);
    const a = resolveStackPaths({ environment: shared });
    const b = resolveStackPaths({
      environment: { ...shared, PYTHIA_DEV_REPO_ROOT: second },
    });
    expect(a.id).not.toBe(b.id);
    expect(a.profile).not.toBe(b.profile);
    expect(a.ports).not.toEqual(b.ports);
    expect(a.workspace).not.toBe(b.workspace);
    expect(a.basicMemoryConfig).not.toBe(b.basicMemoryConfig);
    expect(a.edgarData).not.toBe(b.edgarData);
    expect(a.edgarCache).not.toBe(b.edgarCache);
    expect(a.hermesRoot).toBe(b.hermesRoot);
  });

  it("derives stable lowercase profiles and deterministic non-overlapping ports", () => {
    const identity = stackIdentity("/tmp/Example Worktree");
    expect(identity).toEqual(stackIdentity("/tmp/Example Worktree"));
    expect(identity.profile).toMatch(/^pythia-[a-f0-9]{12}$/u);
    expect(new Set(Object.values(identity.ports)).size).toBe(3);
  });

  it("rejects a profile root that would disable Hermes loop liveness", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({
      environment: environment(
        join(root, "an-extremely-long-segment".repeat(5)),
      ),
    });
    expect(() => assertHermesRuntimePath(paths, "darwin")).toThrow(
      /too long.*loop-liveness socket/u,
    );
  });

  it("constructs only the qualified native commands", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const commands = runtimeCommands(paths);
    expect(commands.profileCreate).toEqual([
      "profile",
      "create",
      paths.profile,
      "--no-alias",
      "--no-skills",
    ]);
    expect(commands.hermesGateway).toEqual([
      "-p",
      paths.profile,
      "gateway",
      "run",
      "--external-supervisor",
    ]);
    expect(commands.basicMemoryMcp).toEqual([
      "mcp",
      "--transport",
      "streamable-http",
      "--host",
      "127.0.0.1",
      "--port",
      String(paths.ports.memory),
      "--path",
      "/mcp",
      "--project",
      paths.id,
    ]);
    expect(commands.managedRunnerBuild).toEqual(["run", "build:runtime"]);
    expect(commands.desk).toEqual([
      "--filter",
      "@pythia/desk",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(paths.ports.desk),
    ]);
    expect(nativeRootAuthArguments("add", "openai-codex")).toEqual([
      "auth",
      "add",
      "--type",
      "oauth",
      "openai-codex",
    ]);
    expect(nativeRootAuthArguments("status", "openai-codex")).toEqual([
      "auth",
      "status",
      "openai-codex",
    ]);
    expect(nativeRootAuthArguments("logout", "openai-codex")).toEqual([
      "auth",
      "logout",
      "openai-codex",
    ]);
    for (const action of ["add", "status", "logout"]) {
      expect(nativeRootAuthArguments(action, "openai-codex")).not.toContain(
        "-p",
      );
    }
  });

  it("inherits only shared model fields once through native config commands", () => {
    const paths = resolveStackPaths({
      environment: environment(temporaryRoot()),
    });
    let current: unknown = "";
    const commands: string[][] = [];
    const shared = {
      provider: "openai-codex",
      default: "fixture-model",
      api_key: "must-not-copy",
    };
    const execute = (_paths: unknown, args: string[]) => {
      commands.push(args);
      if (args[1] === "default") return JSON.stringify(shared);
      if (args[3] === "set") {
        current = {
          ...(typeof current === "object" ? current : {}),
          [args[4].slice("model.".length)]: args[5],
        };
        return "saved";
      }
      return JSON.stringify(current);
    };
    expect(inheritModelDefaults(paths, "fixture-key", { execute })).toBe(true);
    expect(current).toEqual({
      provider: "openai-codex",
      default: "fixture-model",
    });
    commands.length = 0;
    shared.provider = "openrouter";
    expect(inheritModelDefaults(paths, "fixture-key", { execute })).toBe(false);
    expect(commands).toHaveLength(1);
    current = { provider: "anthropic" };
    expect(inheritModelDefaults(paths, "fixture-key", { execute })).toBe(false);
    current = "";
    expect(inheritModelDefaults(paths, "fixture-key", { execute })).toBe(true);
    expect(current).toEqual({
      provider: "openrouter",
      default: "fixture-model",
    });
    expect(nativeRootAuthArguments("add", "openrouter", "api-key")).toEqual([
      "auth",
      "add",
      "--type",
      "api-key",
      "openrouter",
    ]);
    expect(() =>
      nativeRootAuthArguments("add", "openrouter", "unknown"),
    ).toThrow();
  });

  it("leaves an unconfigured profile alone when shared defaults are absent", () => {
    const paths = resolveStackPaths({
      environment: environment(temporaryRoot()),
    });
    const execute = vi.fn(() => JSON.stringify(""));
    expect(inheritModelDefaults(paths, "fixture-key", { execute })).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://user:secret@models.example/v1",
    "https://models.example/v1?key=secret",
    "https://models.example/v1#secret",
  ])(
    "rejects credential-bearing shared endpoints before writing: %s",
    (base_url) => {
      const paths = resolveStackPaths({
        environment: environment(temporaryRoot()),
      });
      const execute = vi.fn((_paths: unknown, args: string[]) =>
        JSON.stringify(
          args[1] === "default"
            ? { provider: "openrouter", default: "fixture-model", base_url }
            : "",
        ),
      );
      expect(() =>
        inheritModelDefaults(paths, "fixture-key", { execute }),
      ).toThrow("Shared model endpoint must not contain");
      expect(execute.mock.calls.some(([, args]) => args.includes("set"))).toBe(
        false,
      );
    },
  );

  it("requires native readback and preserves a string model choice", () => {
    const paths = resolveStackPaths({
      environment: environment(temporaryRoot()),
    });
    const execute = vi.fn((_paths: unknown, args: string[]) =>
      JSON.stringify(
        args[1] === "default"
          ? { provider: "openrouter", default: "fixture-model" }
          : "",
      ),
    );
    expect(() =>
      inheritModelDefaults(paths, "fixture-key", { execute }),
    ).toThrow("Hermes did not retain");
    const existing = vi.fn(() => JSON.stringify("my-model"));
    expect(
      inheritModelDefaults(paths, "fixture-key", { execute: existing }),
    ).toBe(false);
    expect(existing).toHaveBeenCalledTimes(1);
  });

  it("seeds native terminal.cwd once, reads it back, and preserves an override", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    let configured: string | null = null;
    const commands: string[][] = [];
    const execute = (_paths: unknown, args: string[]) => {
      commands.push(args);
      if (args[3] === "set") {
        configured = args[5] ?? null;
        return "saved";
      }
      return JSON.stringify(configured);
    };

    expect(
      ensureNativeWorkspaceCwd(paths, "fixture-api-key", {
        freshProfile: true,
        execute,
      }),
    ).toBe(paths.workspace);
    expect(commands).toEqual([
      ["-p", paths.profile, "config", "set", "terminal.cwd", paths.workspace],
      ["-p", paths.profile, "config", "get", "terminal.cwd", "--json"],
    ]);

    commands.length = 0;
    configured = join(root, "user-selected-workspace");
    expect(
      ensureNativeWorkspaceCwd(paths, "fixture-api-key", { execute }),
    ).toBe(configured);
    expect(commands).toEqual([
      ["-p", paths.profile, "config", "get", "terminal.cwd", "--json"],
    ]);
  });

  it("diagnoses an older profile without silently migrating terminal.cwd", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const commands: string[][] = [];
    expect(() =>
      ensureNativeWorkspaceCwd(paths, "fixture-api-key", {
        execute: (_paths: unknown, args: string[]) => {
          commands.push(args);
          throw new Error(
            "hermes config get failed: Config key not set: terminal.cwd",
          );
        },
      }),
    ).toThrow(/will not silently migrate.*config set terminal\.cwd/u);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("get");
    expect(commands[0]).not.toContain("set");
  });
});

describe("private roots, environment, seeds, and copied assets", () => {
  it("rejects a stale native Basic Memory mapping despite a matching Pythia receipt", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    expect(() =>
      verifyBasicMemoryNativeProject(
        paths,
        "/managed/basic-memory",
        {},
        {
          run: () =>
            JSON.stringify({
              project_name: paths.id,
              project_path: join(root, "foreign-knowledge"),
              available_projects: {
                [paths.id]: {
                  path: join(root, "foreign-knowledge"),
                  is_default: true,
                },
              },
              default_project: paths.id,
              system: { version: "0.23.2" },
              embedding_status: { semantic_search_enabled: false },
            }),
        },
      ),
    ).toThrow(/native project mapping/u);
  });

  it("rejects loose credential-root permissions", () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    const path = join(root, "credentials");
    mkdirSync(path, { mode: 0o755 });
    chmodSync(path, 0o755);
    expect(() => ensurePrivateDirectory(path)).toThrow(
      /permissions are too open/u,
    );
  });

  it("creates per-stack EDGAR data and cache as private bootstrap roots", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    ensurePrivateTree(developmentPrivateRoots(paths));
    for (const path of [paths.edgarData, paths.edgarCache]) {
      expect(lstatSync(path).isDirectory()).toBe(true);
      if (process.platform !== "win32") {
        expect(lstatSync(path).mode & 0o077).toBe(0);
      }
    }
  });

  it("removes ambient credentials and fixes Basic Memory offline settings", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const clean = runtimeEnvironment(paths, "safe-local-key-value", {
      PATH: process.env.PATH,
      OPENAI_API_KEY: "must-not-survive",
      AWS_SECRET_ACCESS_KEY: "must-not-survive",
      AWS_ACCESS_KEY_ID: "must-not-survive",
      EODHD_API_TOKEN: "must-not-survive",
      EDGAR_IDENTITY: "must-not-survive",
      EDGAR_API_TOKEN: "must-not-survive",
      NEXT_TELEMETRY_DISABLED: "0",
      HERMES_DISABLE_LAZY_INSTALLS: "0",
      ORDINARY_SETTING: "visible",
    });
    expect(clean.OPENAI_API_KEY).toBeUndefined();
    expect(clean.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(clean.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(clean.EODHD_API_TOKEN).toBeUndefined();
    expect(clean.EDGAR_IDENTITY).toBeUndefined();
    expect(clean.EDGAR_API_TOKEN).toBeUndefined();
    expect(clean.ORDINARY_SETTING).toBe("visible");
    expect(clean.BASIC_MEMORY_NO_PROMOS).toBe("true");
    expect(clean.BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED).toBe("false");
    expect(clean.FASTMCP_CHECK_FOR_UPDATES).toBe("off");
    expect(clean.FASTMCP_SHOW_SERVER_BANNER).toBe("false");
    expect(clean.NEXT_TELEMETRY_DISABLED).toBe("1");
    expect(clean.HERMES_DISABLE_LAZY_INSTALLS).toBe("1");
    expect(clean.BASIC_MEMORY_CONFIG_DIR).toBe(paths.basicMemoryConfig);
    expect(clean.API_SERVER_HOST).toBe("127.0.0.1");
    expect(clean.PYTHIA_HERMES_API_KEY).toBeUndefined();
    expect(clean.HERMES_HOME).toBe(paths.hermesRoot);
    expect(clean.PYTHIA_CONFIG_ROOT).toBe(paths.configRoot);
    expect(clean.PYTHIA_STATE_ROOT).toBe(paths.stateRoot);
    expect(clean.PYTHIA_MANAGED_ROOT).toBe(paths.managedRoot);
    expect(clean.PYTHIA_EDGAR_DATA_DIR).toBe(paths.edgarData);
    expect(clean.PYTHIA_EDGAR_CACHE_DIR).toBe(paths.edgarCache);
    expect(clean.PYTHIA_PYTHON).toBe(
      join(paths.managedPython, ".venv", "bin", "python"),
    );
    expect(clean.PYTHIA_NODE).toBe(process.execPath);
    expect(clean.PYTHIA_CONFIG_DIR).toBeUndefined();
    expect(clean.PYTHIA_HERMES_PROFILE).toBe(paths.profile);
    expect(clean.PYTHIA_HERMES_EXECUTABLE).toBe(
      join(paths.hermesSource, ".venv", "bin", "hermes"),
    );
    expect(clean.PYTHIA_DEV_LIFECYCLE_CLI).toBe(
      join(paths.repositoryRoot, "scripts", "dev", "cli.mjs"),
    );
    const services = developmentServices(paths, clean);
    expect(services[0]?.cwd).toBe(paths.workspace);
    expect(services[1]?.environment.API_SERVER_KEY).toBeUndefined();
    expect(services[0]?.environment.API_SERVER_KEY).toBe(
      "safe-local-key-value",
    );
    expect(services[2]?.environment.API_SERVER_KEY).toBe(
      "safe-local-key-value",
    );
    expect(
      JSON.stringify(
        redactedEnvironment({ API_SERVER_KEY: "x", SECRET: "x", OK: "y" }),
      ),
    ).not.toContain("x");
  });

  it("installs the fresh Pythia scaffold once and preserves later edits", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.profileRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.hermesRoot, "auth.json"), "fixture credential\n", {
      mode: 0o600,
    });
    writeFileSync(
      join(paths.profileRoot, "config.yaml"),
      "upstream: default\n",
    );
    writeFileSync(join(paths.profileRoot, "SOUL.md"), "upstream default\n");
    const first = installSeeds(paths, { freshProfile: true });
    expect(first.installed).toContain("hermes-profile/config.yaml");
    expect(
      readFileSync(join(paths.profileRoot, "config.yaml"), "utf8"),
    ).toContain("auxiliary:\n  free_only: true\n");
    const expectedPlatformToolsets = `platform_toolsets:
  cli:
    - cronjob
    - delegation
    - file
    - memory
    - session_search
    - skills
    - terminal
    - todo
    - vision
    - web
  cron:
    - cronjob
    - delegation
    - file
    - memory
    - session_search
    - skills
    - terminal
    - todo
    - vision
    - web
  api_server:
    - cronjob
    - delegation
    - file
    - memory
    - session_search
    - skills
    - terminal
    - todo
    - vision
    - web
`;
    expect(
      readFileSync(join(paths.profileRoot, "config.yaml"), "utf8"),
    ).toContain(expectedPlatformToolsets);
    expect(readFileSync(join(paths.profileRoot, "SOUL.md"), "utf8")).toContain(
      "Pythia",
    );
    for (const path of [
      join(paths.workspace, "AGENTS.md"),
      join(paths.workspace, "DATA_SOURCES.md"),
      join(paths.workspace, "portfolio", "README.md"),
      join(paths.workspace, "cases", "README.md"),
      join(paths.workspace, "scratch", "README.md"),
      join(paths.knowledge, "README.md"),
    ]) {
      expect(lstatSync(path).isFile()).toBe(true);
    }
    const userConfig = `auxiliary:
  free_only: false
terminal:
  cwd: /user/chosen/workspace
plugins:
  disabled:
    - pythia
platform_toolsets:
  api_server:
    - file
`;
    writeFileSync(join(paths.profileRoot, "config.yaml"), userConfig);
    writeFileSync(join(paths.profileRoot, "SOUL.md"), "my later edit\n");
    const userFiles = [
      join(paths.workspace, "AGENTS.md"),
      join(paths.workspace, "DATA_SOURCES.md"),
      join(paths.workspace, "portfolio", "README.md"),
      join(paths.workspace, "cases", "README.md"),
      join(paths.workspace, "scratch", "README.md"),
      join(paths.knowledge, "README.md"),
    ];
    for (const path of userFiles) writeFileSync(path, `user edit ${path}\n`);
    rmSync(join(paths.workspace, "scratch", "README.md"));
    const second = installSeeds(paths);
    expect(second).toEqual({
      installed: [],
      preserved: [],
      skipped: "profile-already-initialized",
    });
    expect(readFileSync(join(paths.profileRoot, "config.yaml"), "utf8")).toBe(
      userConfig,
    );
    expect(readFileSync(join(paths.profileRoot, "SOUL.md"), "utf8")).toBe(
      "my later edit\n",
    );
    expect(readFileSync(join(paths.hermesRoot, "auth.json"), "utf8")).toBe(
      "fixture credential\n",
    );
    for (const path of userFiles.filter(
      (path) => path !== join(paths.workspace, "scratch", "README.md"),
    )) {
      expect(readFileSync(path, "utf8")).toBe(`user edit ${path}\n`);
    }
    expect(existsSync(join(paths.workspace, "scratch", "README.md"))).toBe(
      false,
    );
    const receipt = readJson(join(paths.stateRoot, "seed-receipt.json"));
    expect(receipt.fresh_profile_transaction).toBe(true);
  });

  it("refreshes managed plugin files without changing later native user choices", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const managedPlugin = join(root, "managed-plugin");
    const commandLog = join(root, "hermes-commands.log");
    const hermes = join(paths.hermesSource, ".venv", "bin", "hermes");
    const userConfig = `skills:
  external_dirs:
    - /user/skills
plugins:
  disabled:
    - pythia
mcp_servers:
  basic-memory:
    enabled: false
    url: http://127.0.0.1:9999/mcp
`;
    mkdirSync(managedPlugin, { recursive: true });
    writeFileSync(join(managedPlugin, "__init__.py"), "MANAGED = True\n");
    writeFileSync(join(managedPlugin, "plugin.yaml"), "name: pythia\n");
    mkdirSync(join(paths.profileRoot, "plugins", "pythia"), {
      recursive: true,
    });
    writeFileSync(join(paths.profileRoot, "config.yaml"), userConfig);
    writeFileSync(
      join(paths.profileRoot, "plugins", "pythia", "plugin.yaml"),
      "name: stale\n",
    );
    mkdirSync(join(paths.hermesSource, ".venv", "bin"), { recursive: true });
    writeFileSync(
      hermes,
      `#!/bin/sh
printf '%s\\n' "$*" >> '${commandLog}'
`,
      { mode: 0o755 },
    );
    chmodSync(hermes, 0o755);

    await refreshRuntimeAssets(
      { ...paths, managedPlugin },
      "safe-local-key-value",
    );

    expect(readFileSync(join(paths.profileRoot, "config.yaml"), "utf8")).toBe(
      userConfig,
    );
    expect(
      readFileSync(
        join(paths.profileRoot, "plugins", "pythia", "plugin.yaml"),
        "utf8",
      ),
    ).toBe("name: pythia\n");
    expect(readFileSync(commandLog, "utf8").trim()).toBe(
      `-p ${paths.profile} plugins doctor ${join(paths.profileRoot, "plugins", "pythia")} --ci`,
    );
  });

  it("recreates a tampered Hermes source cache from the verified archive", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const commit = "fixture-commit";
    const archive = join(paths.fetchCache, `hermes-${commit}.tar.gz`);
    const archiveInput = join(root, "archive-input", "hermes-fixture");
    mkdirSync(archiveInput, { recursive: true });
    mkdirSync(paths.fetchCache, { recursive: true });
    writeFileSync(
      join(archiveInput, "pyproject.toml"),
      "[project]\nname='fixture'\n",
    );
    writeFileSync(join(archiveInput, "uv.lock"), "version = 1\n");
    writeFileSync(join(archiveInput, "hermes.py"), "TRUSTED = True\n");
    mkdirSync(join(archiveInput, "package", "hermes_agent.egg-info"), {
      recursive: true,
    });
    writeFileSync(
      join(archiveInput, "package", "hermes_agent.egg-info", "PKG-INFO"),
      "source-owned metadata\n",
    );
    execFileSync("tar", [
      "-czf",
      archive,
      "-C",
      join(root, "archive-input"),
      "hermes-fixture",
    ]);
    const archiveSha256 = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    const contract = {
      release: "fixture",
      commit,
      archive_url: "https://invalid.example/hermes.tar.gz",
      archive_sha256: archiveSha256,
    };

    await ensureHermesSource(paths, contract);
    mkdirSync(join(paths.hermesSource, ".venv"));
    writeFileSync(join(paths.hermesSource, ".venv", "keep"), "derived\n");
    mkdirSync(join(paths.hermesSource, "hermes_agent.egg-info"));
    writeFileSync(
      join(paths.hermesSource, "hermes_agent.egg-info", "PKG-INFO"),
      "derived editable-install metadata\n",
    );
    await ensureHermesSource(paths, contract);
    expect(
      readFileSync(join(paths.hermesSource, ".venv", "keep"), "utf8"),
    ).toBe("derived\n");
    expect(
      readFileSync(
        join(paths.hermesSource, "hermes_agent.egg-info", "PKG-INFO"),
        "utf8",
      ),
    ).toBe("derived editable-install metadata\n");
    writeFileSync(
      join(paths.hermesSource, "package", "hermes_agent.egg-info", "PKG-INFO"),
      "tampered nested source\n",
    );

    await ensureHermesSource(paths, contract);

    expect(readFileSync(join(paths.hermesSource, "hermes.py"), "utf8")).toBe(
      "TRUSTED = True\n",
    );
    expect(
      readFileSync(
        join(
          paths.hermesSource,
          "package",
          "hermes_agent.egg-info",
          "PKG-INFO",
        ),
        "utf8",
      ),
    ).toBe("source-owned metadata\n");
    expect(existsSync(join(paths.hermesSource, ".venv"))).toBe(false);
    expect(
      readJson(join(paths.hermesSource, ".pythia-source.json")),
    ).toMatchObject({
      commit,
      archive_sha256: archiveSha256,
      source_tree_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("recovers only a receipt-owned interrupted first profile", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.profileRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.workspace, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.profileRoot, "partial"), "native scaffold\n");
    writeFileSync(join(paths.workspace, "owned"), "preserve me\n");
    atomicWriteJson(paths.profileInitialization, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "native-profile-created",
    });
    const result = await recoverDevelopmentInitialization(paths);
    expect(result.removed_profile).toBe(paths.profileRoot);
    expect(existsSync(paths.profileRoot)).toBe(false);
    expect(existsSync(paths.profileInitialization)).toBe(false);
    expect(readFileSync(join(paths.workspace, "owned"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(existsSync(paths.hermesRoot)).toBe(true);
    expect(existsSync(paths.preparationAdmission)).toBe(false);
  });

  it("never treats an intent-only marker as ownership of an existing profile", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.profileRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.profileRoot, "unknown-owner"), "preserve me\n");
    atomicWriteJson(paths.profileInitialization, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "started",
    });
    expect(() => recoverInterruptedProfileInitialization(paths)).toThrow(
      /ownership is ambiguous.*Refusing to delete/u,
    );
    expect(readFileSync(join(paths.profileRoot, "unknown-owner"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(existsSync(paths.profileInitialization)).toBe(true);
  });

  it("clears an intent-only marker when no profile exists", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    atomicWriteJson(paths.profileInitialization, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "started",
    });
    expect(recoverInterruptedProfileInitialization(paths).recovered).toBe(true);
    expect(existsSync(paths.profileInitialization)).toBe(false);
  });

  it("refreshes the exact managed plugin files and rejects canonical source symlinks", () => {
    const root = temporaryRoot();
    const source = join(root, "source");
    const profile = join(root, "profile");
    const destination = join(profile, "plugins", "pythia");
    mkdirSync(source);
    writeFileSync(join(source, "__init__.py"), "FIRST = True\n");
    writeFileSync(join(source, "plugin.yaml"), "name: first\n");
    mkdirSync(join(source, "__pycache__"));
    writeFileSync(
      join(source, "__pycache__", "__init__.cpython-314.pyc"),
      "generated\n",
    );
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "stale.pyc"), "stale\n");
    writeFileSync(`${destination}.previous`, "foreign sibling\n");
    writeFileSync(join(profile, "user-state"), "preserve me\n");

    refreshManagedPlugin(source, destination);

    expect(lstatSync(destination).isSymbolicLink()).toBe(false);
    expect(readdirSync(destination).sort()).toEqual(
      [...MANAGED_PLUGIN_FILES].sort(),
    );
    expect(readFileSync(join(profile, "user-state"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(readFileSync(`${destination}.previous`, "utf8")).toBe(
      "foreign sibling\n",
    );
    writeFileSync(join(source, "plugin.yaml"), "name: second\n");
    refreshManagedPlugin(source, destination);
    expect(readFileSync(join(destination, "plugin.yaml"), "utf8")).toContain(
      "second",
    );
    rmSync(join(source, "__init__.py"));
    symlinkSync(join(source, "plugin.yaml"), join(source, "__init__.py"));
    expect(() => refreshManagedPlugin(source, destination)).toThrow(
      /input must be a regular file/u,
    );
    expect(readFileSync(join(destination, "plugin.yaml"), "utf8")).toContain(
      "second",
    );
  });

  it("refreshes only canonical managed Python inputs without replacing its environment", () => {
    const root = temporaryRoot();
    const source = join(root, "source");
    const runtimeRoot = join(root, "runtime");
    const destination = join(runtimeRoot, "managed-python");
    mkdirSync(source);
    for (const filename of MANAGED_PYTHON_SOURCE_FILES) {
      writeFileSync(join(source, filename), `${filename}\n`);
    }
    mkdirSync(join(source, ".venv", "bin"), { recursive: true });
    writeFileSync(join(source, ".venv", "bin", "python"), "generated\n");
    mkdirSync(join(destination, ".venv"), { recursive: true });
    writeFileSync(join(destination, ".venv", "stale"), "stale\n");
    writeFileSync(join(destination, "obsolete-input.txt"), "remove me\n");
    writeFileSync(join(runtimeRoot, "preserved"), "preserve me\n");

    refreshManagedPythonSource(source, destination);

    expect(readdirSync(destination).sort()).toEqual(
      [...MANAGED_PYTHON_SOURCE_FILES, ".venv"].sort(),
    );
    expect(readFileSync(join(destination, ".venv", "stale"), "utf8")).toBe(
      "stale\n",
    );
    expect(existsSync(join(destination, "obsolete-input.txt"))).toBe(false);
    expect(readFileSync(join(runtimeRoot, "preserved"), "utf8")).toBe(
      "preserve me\n",
    );
    rmSync(join(source, "uv.lock"));
    symlinkSync(join(source, "pyproject.toml"), join(source, "uv.lock"));
    expect(() => refreshManagedPythonSource(source, destination)).toThrow(
      /input must be a regular file/u,
    );
    expect(readdirSync(destination).sort()).toEqual(
      [...MANAGED_PYTHON_SOURCE_FILES, ".venv"].sort(),
    );
  });

  it("prepares locked dependencies before one runner build and reuses native environments", async () => {
    const root = temporaryRoot();
    const resolved = resolveStackPaths({ environment: environment(root) });
    const managedPythonSource = join(root, "managed-python-source");
    const managedPython = join(root, "managed-python-runtime");
    mkdirSync(managedPythonSource);
    for (const filename of MANAGED_PYTHON_SOURCE_FILES) {
      writeFileSync(join(managedPythonSource, filename), `${filename} first\n`);
    }
    mkdirSync(join(managedPython, ".venv", "bin"), { recursive: true });
    writeFileSync(
      join(managedPython, ".venv", "bin", "python"),
      "preserved interpreter\n",
    );
    const paths = { ...resolved, managedPythonSource, managedPython };
    const sourceContract = {
      install: { command: ["uv", "sync", "--frozen", "--extra", "all"] },
    };
    const actions: string[] = [];
    const options = {
      sourceContract,
      environment: { PATH: "/fixture/bin" },
      ensureHermesSource: async () => {
        actions.push("hermes-source");
      },
      runCommand: (command: string, args: string[]) => {
        actions.push(`${command} ${args.join(" ")}`);
        return "";
      },
    };

    await prepareManagedRuntime(paths, options);
    await prepareManagedRuntime(paths, options);
    writeFileSync(join(managedPythonSource, "uv.lock"), "uv.lock second\n");
    await prepareManagedRuntime(paths, options);

    const onePreparation = [
      "hermes-source",
      "uv sync --frozen --extra all",
      `uv sync --frozen --project ${managedPython}`,
      "pnpm install --frozen-lockfile",
      "pnpm run build:runtime",
    ];
    expect(actions).toEqual([
      ...onePreparation,
      ...onePreparation,
      ...onePreparation,
    ]);
    expect(
      readFileSync(join(managedPython, ".venv", "bin", "python"), "utf8"),
    ).toBe("preserved interpreter\n");
    expect(readFileSync(join(managedPython, "uv.lock"), "utf8")).toBe(
      "uv.lock second\n",
    );
  });
});

describe("port and receipt ownership", () => {
  it("uses native no-reuse-address semantics for Hermes port release", async () => {
    const available = createServer();
    await new Promise<void>((resolve) =>
      available.listen(0, "127.0.0.1", resolve),
    );
    const availableAddress = available.address();
    if (!availableAddress || typeof availableAddress === "string") {
      throw new Error("Could not allocate an available fixture port");
    }
    await new Promise<void>((resolve) => available.close(() => resolve()));

    await expect(
      waitForNoReuseAddressPortRelease({
        python: "python3",
        host: "127.0.0.1",
        port: availableAddress.port,
        timeoutMs: 1_000,
        quietMs: 100,
        intervalMs: 50,
      }),
    ).resolves.toBeUndefined();

    const occupied = createServer();
    servers.push(occupied);
    await new Promise<void>((resolve) =>
      occupied.listen(0, "127.0.0.1", resolve),
    );
    const occupiedAddress = occupied.address();
    if (!occupiedAddress || typeof occupiedAddress === "string") {
      throw new Error("Could not allocate an occupied fixture port");
    }
    await expect(
      waitForNoReuseAddressPortRelease({
        python: "python3",
        host: "127.0.0.1",
        port: occupiedAddress.port,
        timeoutMs: 250,
        quietMs: 100,
        intervalMs: 50,
      }),
    ).rejects.toThrow(/not continuously free.*native no-reuse-address/u);
  });

  it("fails actionably instead of taking over a foreign listener", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(paths.ports.hermes, "127.0.0.1", resolve),
    );
    await expect(assertPortsFree(paths.ports)).rejects.toThrow(
      /will not take over/u,
    );
    const started = Date.now();
    await expect(supervise(paths, [], { stdio: "ignore" })).rejects.toThrow(
      /will not take over/u,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(server.listening).toBe(true);
    expect(existsSync(paths.receipt)).toBe(false);
  });

  it("refuses foreign and stale receipts without signaling", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.processRoot, { recursive: true, mode: 0o700 });
    const foreign = {
      schema_version: 1,
      stack: "someone-else",
      repository: paths.repositoryRoot,
    };
    expect(() => validateReceipt(paths, foreign)).toThrow(/does not belong/u);
    atomicWriteJson(paths.receipt, foreign);
    await expect(requestHermesRestart(paths, 500)).rejects.toThrow(
      /does not belong/u,
    );
    rmSync(paths.receipt);

    const sleeper = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    children.push(sleeper);
    const sleeperPid = sleeper.pid;
    if (!sleeperPid) throw new Error("Fixture sleeper did not start");
    await waitUntil(() => Boolean(processIdentity(sleeperPid)));
    const identity = processIdentity(sleeperPid);
    if (!identity) throw new Error("Fixture sleeper has no process identity");
    atomicWriteJson(paths.receipt, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      supervisor: { ...identity, command_sha256: "0".repeat(64) },
      children: [],
    });
    await expect(stopStack(paths)).rejects.toThrow(/Refusing to signal/u);
    await expect(requestHermesRestart(paths, 500)).rejects.toThrow(
      /supervisor receipt is stale or foreign/u,
    );
    expect(processIdentity(sleeperPid)).not.toBeNull();
    expect(() => resetDerivedDevelopmentState(paths)).toThrow(/stale receipt/u);
  });
});

describe("foreground supervision", () => {
  it("refuses duplicate live init and dev CLIs before any preparation mutation", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root);
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const fakeBin = join(root, "fake-bin");
    const commandLog = join(root, "preparation-commands.log");
    mkdirSync(fakeBin);
    for (const command of ["pnpm", "uv"]) {
      const executable = join(fakeBin, command);
      writeFileSync(
        executable,
        `#!/bin/sh\nprintf '%s\\n' '${command}' >> '${commandLog}'\nexit 75\n`,
      );
      chmodSync(executable, 0o700);
    }
    const copiedPlugin = join(
      fixture.paths.profileRoot,
      "plugins",
      "pythia",
      "plugin.yaml",
    );
    mkdirSync(dirname(copiedPlugin), { recursive: true, mode: 0o700 });
    writeFileSync(copiedPlugin, "user-visible-live-copy\n");
    const cliEnvironment = {
      ...fixture.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
    };

    for (const command of ["init", "dev"]) {
      const result = await runLifecycleCli(cliEnvironment, command);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/live foreground owner/u);
      expect(existsSync(commandLog)).toBe(false);
      expect(readFileSync(copiedPlugin, "utf8")).toBe(
        "user-visible-live-copy\n",
      );
      expect(existsSync(fixture.paths.preparationAdmission)).toBe(false);
    }
    await stopStack(fixture.paths);
  });

  it("serializes real development entrypoints and releases failed preparation", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const cacheMarker = join(paths.cacheRoot, "preserve-during-live-prep");
    mkdirSync(paths.cacheRoot, { recursive: true, mode: 0o700 });
    writeFileSync(cacheMarker, "preserve\n");
    let preparationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    let finishPreparation!: () => void;
    const finish = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    let startupMutations = 0;
    let competingMutations = 0;
    const startup = runDevelopment(paths, {
      async prepareRuntime() {
        startupMutations += 1;
        preparationStarted();
        await finish;
        return { environment: {} };
      },
      async supervise(
        _paths: typeof paths,
        _services: unknown,
        options: { onReceiptOwned: () => void },
      ) {
        options.onReceiptOwned();
        return { kind: "fixture-complete" };
      },
    });
    await started;

    await expect(
      initializeDevelopmentRuntime(paths, {
        async prepareRuntime() {
          competingMutations += 1;
        },
      }),
    ).rejects.toThrow(/live preparation owner/u);
    expect(() => resetDerivedDevelopmentState(paths)).toThrow(
      /live preparation owner/u,
    );
    expect(readFileSync(cacheMarker, "utf8")).toBe("preserve\n");
    expect(startupMutations).toBe(1);
    expect(competingMutations).toBe(0);

    finishPreparation();
    await expect(startup).resolves.toEqual({ kind: "fixture-complete" });
    expect(existsSync(paths.preparationAdmission)).toBe(false);

    await expect(
      initializeDevelopmentRuntime(paths, {
        async prepareRuntime() {
          throw new Error("synthetic preparation failure");
        },
      }),
    ).rejects.toThrow(/synthetic preparation failure/u);
    expect(existsSync(paths.preparationAdmission)).toBe(false);
    await expect(
      initializeDevelopmentRuntime(paths, {
        async prepareRuntime() {
          competingMutations += 1;
          return { prepared: true };
        },
      }),
    ).resolves.toEqual({ prepared: true });
    expect(competingMutations).toBe(1);
  });

  it("runs initialized native auth through the exact CLI without preparation", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root);
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const hermes = runtimeCommands(fixture.paths).hermes;
    const authLog = join(root, "native-auth.log");
    mkdirSync(dirname(hermes), { recursive: true, mode: 0o700 });
    writeFileSync(
      hermes,
      `#!/bin/sh\nprintf '%s|%s\\n' "$HERMES_HOME" "$*" >> '${authLog}'\n`,
    );
    chmodSync(hermes, 0o700);
    atomicWriteJson(fixture.paths.runtimeReceipt, {
      schema_version: 1,
      stack: fixture.paths.id,
      repository: fixture.paths.repositoryRoot,
      profile: fixture.paths.profile,
      hermes_root: fixture.paths.hermesRoot,
      state_root: fixture.paths.stateRoot,
    });
    const copiedPlugin = join(
      fixture.paths.profileRoot,
      "plugins",
      "pythia",
      "plugin.yaml",
    );
    mkdirSync(dirname(copiedPlugin), { recursive: true, mode: 0o700 });
    writeFileSync(copiedPlugin, "preserved-auth-copy\n");

    const result = await runLifecycleCli(fixture.env, "auth", "openai-codex");
    expect(result).toMatchObject({ code: 0, stderr: "", stdout: "" });
    expect(readFileSync(authLog, "utf8").trim()).toBe(
      `${fixture.paths.hermesRoot}|-p default auth add --type oauth openai-codex`,
    );
    expect(readFileSync(copiedPlugin, "utf8")).toBe("preserved-auth-copy\n");
    expect(existsSync(join(fixture.paths.configRoot, "secrets.json"))).toBe(
      false,
    );
    expect(existsSync(fixture.paths.preparationAdmission)).toBe(false);
    rmSync(fixture.paths.runtimeReceipt);
    const uninitialized = await runLifecycleCli(
      fixture.env,
      "auth",
      "openai-codex",
    );
    expect(uninitialized.code).toBe(1);
    expect(uninitialized.stderr).toMatch(/just dev-init/u);
    expect(readFileSync(authLog, "utf8").trim()).toBe(
      `${fixture.paths.hermesRoot}|-p default auth add --type oauth openai-codex`,
    );
    expect(readFileSync(copiedPlugin, "utf8")).toBe("preserved-auth-copy\n");
    await stopStack(fixture.paths);
  });

  it("prepares an explicitly refreshed stopped stack without starting services", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const prepared: string[] = [];
    await expect(
      requestRuntimeRefresh(paths, 500, {
        async prepareRuntime(actualPaths: typeof paths) {
          prepared.push(actualPaths.id);
        },
      }),
    ).resolves.toEqual({ refreshed: true, running: false });
    expect(prepared).toEqual([paths.id]);
    expect(existsSync(paths.receipt)).toBe(false);
  });

  it("proves native Hermes port release before the initial launch", async () => {
    const root = temporaryRoot();
    const started = Date.now();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_INITIAL_HERMES_RELEASE_DELAY_MS: "300",
    });
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    await stopStack(fixture.paths);
  }, 10_000);

  it("preserves ownership records when final port-release validation fails", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_FINAL_RELEASE_FAILURE: "true",
    });
    const unrelated = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    children.push(unrelated);
    const unrelatedPid = unrelated.pid;
    if (!unrelatedPid) throw new Error("Unrelated fixture did not start");
    await waitUntil(
      () =>
        existsSync(join(fixture.paths.stateRoot, "fixture-ready")) &&
        Boolean(processIdentity(unrelatedPid)),
    );
    const receipt = readJson(fixture.paths.receipt);
    atomicWriteJson(fixture.paths.hermesRestartRequest, {
      schema_version: 1,
      stack: fixture.paths.id,
      repository: fixture.paths.repositoryRoot,
      state_root: fixture.paths.stateRoot,
      supervisor: receipt.supervisor,
      operation: "restart-hermes",
      generation: receipt.hermes_generation,
    });

    fixture.child.kill("SIGTERM");
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(existsSync(fixture.paths.receipt)).toBe(true);
    expect(existsSync(fixture.paths.hermesRestartRequest)).toBe(true);
    for (const child of receipt.children) {
      expect(processIdentity(child.pid)).toBeNull();
    }
    expect(processIdentity(unrelatedPid)).not.toBeNull();
  }, 10_000);

  it("preserves the primary failure when cleanup validation also fails", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.processRoot, { recursive: true, mode: 0o700 });
    await expect(
      supervise(
        paths,
        [
          {
            name: "hermes",
            port: paths.ports.hermes,
            command: process.execPath,
            args: [
              join(
                repositoryRoot,
                "scripts",
                "dev",
                "test",
                "fixture-service.mjs",
              ),
              String(paths.ports.hermes),
              "serve",
            ],
            cwd: repositoryRoot,
            environment: process.env,
            async ready() {
              throw new Error("synthetic primary failure");
            },
          },
        ],
        {
          stdio: "ignore",
          hermesReleaseProof: async () => {},
          finalReleaseProof: async () => {
            throw new Error("synthetic cleanup proof failure");
          },
        },
      ),
    ).rejects.toThrow(
      /synthetic primary failure.*Cleanup also failed: synthetic cleanup proof failure/u,
    );
    expect(existsSync(paths.receipt)).toBe(true);
    await assertPortsFree(paths.ports);
  });

  it("exposes the bounded restart through the exact lifecycle CLI", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root);
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const cli = spawn(
      process.execPath,
      [join(repositoryRoot, "scripts", "dev", "cli.mjs"), "restart-hermes"],
      {
        cwd: repositoryRoot,
        env: fixture.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(cli);
    let stdout = "";
    let stderr = "";
    cli.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    cli.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve) => {
      cli.once("close", resolve);
    });
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      restarted: true,
      generation: 1,
    });
    await stopStack(fixture.paths);
  }, 10_000);

  it("refreshes only on the explicit CLI and preserves another stack and user state", async () => {
    const root = temporaryRoot();
    const firstRepo = join(root, "first-repo");
    const secondRepo = join(root, "second-repo");
    mkdirSync(firstRepo);
    mkdirSync(secondRepo);
    const source = join(root, "managed-source.txt");
    const output = join(root, "prepared-runtime.txt");
    writeFileSync(source, "runner-and-plugin-v1\n");
    writeFileSync(output, readFileSync(source));
    const first = await startFixture(root, {
      PYTHIA_DEV_REPO_ROOT: firstRepo,
      PYTHIA_TEST_REFRESH_SOURCE: source,
      PYTHIA_TEST_REFRESH_OUTPUT: output,
    });
    const second = await startFixture(root, {
      PYTHIA_DEV_REPO_ROOT: secondRepo,
    });
    await waitUntil(
      () =>
        existsSync(join(first.paths.stateRoot, "fixture-ready")) &&
        existsSync(join(second.paths.stateRoot, "fixture-ready")),
    );
    const userFiles = [
      [join(first.paths.profileRoot, "config.yaml"), "model: user-choice\n"],
      [join(first.paths.workspace, "portfolio.md"), "user portfolio\n"],
      [join(first.paths.knowledge, "note.md"), "user memory\n"],
      [join(first.paths.hermesRoot, "oauth.json"), "user oauth custody\n"],
    ];
    for (const [path, contents] of userFiles) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    }
    const firstBefore = readJson(first.paths.receipt);
    const secondBefore = readJson(second.paths.receipt);

    writeFileSync(source, "runner-and-plugin-v2\n");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const untouched = readJson(first.paths.receipt);
    expect(untouched.runtime_generation).toBe(0);
    expect(untouched.children).toEqual(firstBefore.children);
    expect(readFileSync(output, "utf8")).toBe("runner-and-plugin-v1\n");

    const cli = spawn(
      process.execPath,
      [join(repositoryRoot, "scripts", "dev", "cli.mjs"), "refresh"],
      {
        cwd: repositoryRoot,
        env: first.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(cli);
    let stdout = "";
    let stderr = "";
    cli.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    cli.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve) => {
      cli.once("close", resolve);
    });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      refreshed: true,
      running: true,
      generation: 1,
    });
    const firstAfter = readJson(first.paths.receipt);
    const secondAfter = readJson(second.paths.receipt);
    expect(readFileSync(output, "utf8")).toBe("runner-and-plugin-v2\n");
    expect(firstAfter.runtime_generation).toBe(1);
    for (const child of firstBefore.children) {
      const replacement = firstAfter.children.find(
        (candidate: { name: string }) => candidate.name === child.name,
      );
      expect(replacement.pid).not.toBe(child.pid);
      expect(processIdentity(child.pid)).toBeNull();
    }
    expect(secondAfter.children).toEqual(secondBefore.children);
    expect(secondAfter.runtime_generation).toBe(0);
    for (const [path, contents] of userFiles) {
      expect(readFileSync(path, "utf8")).toBe(contents);
    }
    await stopStack(first.paths);
    await stopStack(second.paths);
  }, 15_000);

  it("fails a refresh without acknowledging or leaving owned services", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_REFRESH_FAILURE: "true",
    });
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    await expect(requestRuntimeRefresh(fixture.paths, 5_000)).rejects.toThrow(
      /foreground supervisor (?:stopped|identity changed)/u,
    );
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(existsSync(fixture.paths.receipt)).toBe(false);
    await assertPortsFree(fixture.paths.ports);
  }, 10_000);

  it("serializes runtime refresh against a settings-only Hermes restart", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_HERMES_READY_DELAY_MS: "400",
    });
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const restart = requestHermesRestart(fixture.paths, 5_000);
    await waitUntil(
      () => readJson(fixture.paths.receipt).hermes_restarting === true,
    );
    await expect(requestRuntimeRefresh(fixture.paths, 500)).rejects.toThrow(
      /settings restart is in progress/u,
    );
    await expect(restart).resolves.toMatchObject({ restarted: true });
    await stopStack(fixture.paths);
  }, 10_000);

  it("coalesces concurrent requests into one Hermes-only healthy restart", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root);
    const unrelated = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    children.push(unrelated);
    const unrelatedPid = unrelated.pid;
    if (!unrelatedPid) throw new Error("Unrelated fixture did not start");
    await waitUntil(
      () =>
        existsSync(join(fixture.paths.stateRoot, "fixture-ready")) &&
        Boolean(processIdentity(unrelatedPid)),
    );
    const before = readJson(fixture.paths.receipt);
    const beforeByName = Object.fromEntries(
      before.children.map((child: { name: string; pid: number }) => [
        child.name,
        child,
      ]),
    );
    const [first, second] = await Promise.all([
      requestHermesRestart(fixture.paths, 5_000),
      requestHermesRestart(fixture.paths, 5_000),
    ]);
    const after = readJson(fixture.paths.receipt);
    const afterByName = Object.fromEntries(
      after.children.map((child: { name: string; pid: number }) => [
        child.name,
        child,
      ]),
    );
    expect(first.generation).toBe(before.hermes_generation + 1);
    expect(second.generation).toBe(first.generation);
    expect(after.hermes_generation).toBe(first.generation);
    expect(afterByName.hermes.pid).not.toBe(beforeByName.hermes.pid);
    expect(afterByName.memory.pid).toBe(beforeByName.memory.pid);
    expect(afterByName.desk.pid).toBe(beforeByName.desk.pid);
    expect(processIdentity(beforeByName.hermes.pid)).toBeNull();
    expect(processIdentity(unrelatedPid)).not.toBeNull();
    await stopStack(fixture.paths);
    await waitUntil(() => processIdentity(afterByName.hermes.pid) === null);
    expect(processIdentity(unrelatedPid)).not.toBeNull();
  });

  it("waits through a transient free/reclaim before starting replacement", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_TRANSIENT_HERMES_RECLAIM: "100:350",
    });
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const before = readJson(fixture.paths.receipt);
    const previousHermes = before.children.find(
      (child: { name: string }) => child.name === "hermes",
    );
    if (!previousHermes) throw new Error("Hermes fixture receipt is missing");
    const started = Date.now();
    const result = await requestHermesRestart(fixture.paths, 8_000);
    const elapsed = Date.now() - started;
    const after = readJson(fixture.paths.receipt);
    const replacement = after.children.find(
      (child: { name: string }) => child.name === "hermes",
    );
    expect(result.generation).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(1_800);
    expect(replacement.pid).not.toBe(previousHermes.pid);
    const response = await fetch(
      `http://127.0.0.1:${fixture.paths.ports.hermes}`,
    );
    expect(response.ok).toBe(true);
    await stopStack(fixture.paths);
    await assertPortsFree(fixture.paths.ports);
  }, 10_000);

  it("does not acknowledge a replacement that dies after initial health", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_HERMES_DIE_AFTER_HEALTH_MS: "250",
      PYTHIA_TEST_USE_HERMES_READINESS: "true",
    });
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    // Shutdown itself allows eight seconds for process-group exit. The client
    // must outlive that cleanup plus port-release/startup on a loaded runner.
    await expect(requestHermesRestart(fixture.paths, 20_000)).rejects.toThrow(
      /foreground supervisor (?:stopped|identity changed)/u,
    );
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(
      existsSync(join(fixture.paths.stateRoot, "fixture-hermes-generation")),
    ).toBe(false);
    expect(existsSync(fixture.paths.receipt)).toBe(false);
    await assertPortsFree(fixture.paths.ports);
  }, 30_000);

  it("starts two independent stacks and stops only the selected owner", async () => {
    const firstRoot = temporaryRoot();
    const secondRoot = temporaryRoot();
    const firstRepo = join(firstRoot, "repo");
    const secondRepo = join(secondRoot, "repo");
    mkdirSync(firstRepo);
    mkdirSync(secondRepo);
    const sharedRoot = temporaryRoot();
    const first = await startFixture(sharedRoot, {
      PYTHIA_DEV_REPO_ROOT: firstRepo,
    });
    const second = await startFixture(sharedRoot, {
      PYTHIA_DEV_REPO_ROOT: secondRepo,
    });
    await waitUntil(
      () =>
        existsSync(join(first.paths.stateRoot, "fixture-ready")) &&
        existsSync(join(second.paths.stateRoot, "fixture-ready")),
    );
    expect(stackStatus(first.paths).status).toBe("running");
    expect(stackStatus(second.paths).status).toBe("running");
    await stopStack(first.paths);
    await waitUntil(() => first.child.exitCode !== null);
    expect(stackStatus(first.paths).status).toBe("stopped");
    expect(stackStatus(second.paths).status).toBe("running");
    await stopStack(second.paths);
  }, 20_000);

  it("tears down the full stack when a sibling exits during Hermes restart", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_HERMES_READY_DELAY_MS: "400",
    });
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const before = readJson(fixture.paths.receipt);
    const memory = before.children.find(
      (child: { name: string }) => child.name === "memory",
    );
    if (!memory) throw new Error("Memory fixture receipt is missing");
    const restart = requestHermesRestart(fixture.paths, 5_000);
    await waitUntil(() => {
      if (!existsSync(fixture.paths.receipt)) return false;
      return readJson(fixture.paths.receipt).hermes_restarting === true;
    });
    process.kill(-memory.pid, "SIGTERM");
    await expect(restart).rejects.toThrow(
      /foreground supervisor (?:stopped|identity changed)/u,
    );
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(existsSync(fixture.paths.receipt)).toBe(false);
    await assertPortsFree(fixture.paths.ports);
  });

  it("refuses a foreign restart request without disturbing the stack", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root);
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const receipt = readJson(fixture.paths.receipt);
    atomicWriteJson(fixture.paths.hermesRestartRequest, {
      schema_version: 1,
      stack: "foreign-stack",
      repository: fixture.paths.repositoryRoot,
      state_root: fixture.paths.stateRoot,
      supervisor: receipt.supervisor,
      operation: "restart-hermes",
      generation: receipt.hermes_generation,
    });
    await expect(requestHermesRestart(fixture.paths, 500)).rejects.toThrow(
      /stale or foreign Hermes restart request/u,
    );
    expect(processIdentity(receipt.supervisor.pid)).not.toBeNull();
    for (const child of receipt.children) {
      expect(processIdentity(child.pid)).not.toBeNull();
    }
    await stopStack(fixture.paths);
  });

  it("stops a service grandchild through its receipt-owned process group", async () => {
    const root = temporaryRoot();
    const grandchildFile = join(root, "grandchild.pid");
    const fixture = await startFixture(root, {
      PYTHIA_TEST_GRANDCHILD_FILE: grandchildFile,
    });
    await waitUntil(
      () =>
        existsSync(join(fixture.paths.stateRoot, "fixture-ready")) &&
        existsSync(grandchildFile),
    );
    const grandchildPid = Number(readFileSync(grandchildFile, "utf8").trim());
    expect(processIdentity(grandchildPid)).not.toBeNull();
    await stopStack(fixture.paths);
    await waitUntil(() => processIdentity(grandchildPid) === null);
  });

  it("kills a receipt-owned descendant that ignores SIGTERM before clearing ownership", async () => {
    const root = temporaryRoot();
    const grandchildFile = join(root, "resistant-grandchild.pid");
    const fixture = await startFixture(root, {
      PYTHIA_TEST_GRANDCHILD_FILE: grandchildFile,
      PYTHIA_TEST_GRANDCHILD_IGNORE_SIGTERM: "true",
    });
    await waitUntil(
      () =>
        existsSync(join(fixture.paths.stateRoot, "fixture-ready")) &&
        existsSync(grandchildFile),
    );
    const grandchildPid = Number(readFileSync(grandchildFile, "utf8").trim());
    expect(processIdentity(grandchildPid)).not.toBeNull();

    await stopStack(fixture.paths);

    await waitUntil(() => processIdentity(grandchildPid) === null);
    expect(existsSync(fixture.paths.receipt)).toBe(false);
    await assertPortsFree(fixture.paths.ports);
  }, 20_000);

  it("cleans every child when a foreground service fails", async () => {
    const root = temporaryRoot();
    const fixture = await startFixture(root, {
      PYTHIA_TEST_FAIL_SERVICE: "memory",
    });
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(existsSync(fixture.paths.receipt)).toBe(false);
    await assertPortsFree(fixture.paths.ports);
  });

  it("resets only current derived state and preserves user-owned roots", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    for (const path of [
      paths.stateRoot,
      paths.cacheRoot,
      paths.workspace,
      paths.knowledge,
      paths.hermesRoot,
      paths.basicMemoryConfig,
    ]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      writeFileSync(join(path, "keep"), "value\n");
    }
    mkdirSync(paths.processRoot, { recursive: true, mode: 0o700 });
    atomicWriteJson(paths.preparationAdmission, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      state_root: paths.stateRoot,
      operation: "stale fixture preparation",
      owner: {
        pid: 999_999_999,
        started: "never",
        command_sha256: "0".repeat(64),
      },
    });
    expect(() => resetDerivedDevelopmentState(paths)).toThrow(
      /stale preparation owner/u,
    );
    expect(readFileSync(join(paths.cacheRoot, "keep"), "utf8")).toBe("value\n");
    rmSync(paths.preparationAdmission);
    atomicWriteJson(paths.preparationAdmission, {
      schema_version: 1,
      stack: "foreign-stack",
      repository: paths.repositoryRoot,
      state_root: paths.stateRoot,
      operation: "foreign fixture preparation",
      owner: {
        pid: 999_999_999,
        started: "never",
        command_sha256: "0".repeat(64),
      },
    });
    expect(() => resetDerivedDevelopmentState(paths)).toThrow(
      /does not belong to this worktree/u,
    );
    expect(readFileSync(join(paths.cacheRoot, "keep"), "utf8")).toBe("value\n");
    rmSync(paths.preparationAdmission);
    const result = resetDerivedDevelopmentState(paths);
    expect(result.reset).toEqual([
      paths.processRoot,
      paths.testRoot,
      paths.cacheRoot,
    ]);
    expect(existsSync(paths.processRoot)).toBe(false);
    expect(existsSync(paths.testRoot)).toBe(false);
    expect(existsSync(paths.cacheRoot)).toBe(false);
    for (const path of [
      paths.workspace,
      paths.knowledge,
      paths.hermesRoot,
      paths.basicMemoryConfig,
    ]) {
      expect(readFileSync(join(path, "keep"), "utf8")).toBe("value\n");
    }
  });
});
