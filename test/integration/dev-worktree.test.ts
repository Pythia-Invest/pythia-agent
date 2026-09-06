import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteJson } from "../../scripts/dev/files.mjs";
import { resolveStackPaths, stackIdentity } from "../../scripts/dev/paths.mjs";
import {
  assertHermesRuntimePath,
  authenticationStatus,
  ensureNativeWorkspaceCwd,
  inheritModelDefaults,
  nativeRootAuthArguments,
  runtimeCommands,
} from "../../scripts/dev/runtime.mjs";
import { copySourceSnapshot } from "../../tooling/source-snapshot.mjs";

const repositoryRoot = new URL("../../", import.meta.url).pathname.replace(
  /\/$/u,
  "",
);
const temporaryRoots: string[] = [];

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

afterEach(() => {
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
