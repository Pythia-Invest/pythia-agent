import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/dev/files.mjs";
import { resolveStackPaths, stackIdentity } from "../../scripts/dev/paths.mjs";
import {
  assertHermesRuntimePath,
  authenticate,
  authenticationStatus,
  ensureNativeWorkspaceCwd,
  nativeRootAuthArguments,
  runtimeCommands,
} from "../../scripts/dev/runtime.mjs";
import {
  developmentEnvironment,
  developmentPaths,
  temporaryRoot,
} from "../support/dev-stack.js";

describe("worktree identity and native command construction", () => {
  it("runs native root auth and status without initializing, preparing or writing secrets", async () => {
    const root = temporaryRoot();
    const paths = developmentPaths(root);
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    const hermes = runtimeCommands(paths).hermes;
    const authLog = join(root, "native-auth.log");
    mkdirSync(dirname(hermes), { recursive: true });
    writeFileSync(
      hermes,
      `#!/bin/sh\nprintf '%s\\n' "$HERMES_HOME|$*" | tee -a '${authLog}'\n`,
    );
    chmodSync(hermes, 0o700);
    const copiedPlugin = join(paths.profileRoot, "plugins/pythia/plugin.yaml");
    mkdirSync(dirname(copiedPlugin), { recursive: true, mode: 0o700 });
    writeFileSync(copiedPlugin, "preserved-auth-copy\n");
    atomicWriteJson(paths.runtimeReceipt, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
    });

    await authenticate(paths, "openai-codex");
    await expect(authenticationStatus(paths, "openai-codex")).resolves.toBe(
      `${paths.hermesRoot}|-p default auth status openai-codex`,
    );
    const nativeCalls = [
      `${paths.hermesRoot}|-p default auth add --type oauth openai-codex`,
      `${paths.hermesRoot}|-p default auth status openai-codex`,
    ];
    expect(readFileSync(authLog, "utf8").trim().split("\n")).toEqual(
      nativeCalls,
    );
    expect(readFileSync(copiedPlugin, "utf8")).toBe("preserved-auth-copy\n");
    expect(existsSync(join(paths.configRoot, "secrets.json"))).toBe(false);
    expect(existsSync(paths.preparationAdmission)).toBe(false);

    rmSync(paths.runtimeReceipt);
    await expect(authenticate(paths, "openai-codex")).rejects.toThrow(
      /just dev-init/u,
    );
    await expect(authenticationStatus(paths, "openai-codex")).rejects.toThrow(
      /just dev-init/u,
    );
    expect(readFileSync(authLog, "utf8").trim().split("\n")).toEqual(
      nativeCalls,
    );
    expect(existsSync(join(paths.configRoot, "secrets.json"))).toBe(false);
  });

  it("gives two worktree paths independent state, profiles, and ports", () => {
    const base = temporaryRoot();
    const first = join(base, "first");
    const second = join(base, "second");
    mkdirSync(first);
    mkdirSync(second);
    const shared = {
      ...developmentEnvironment(base),
      PYTHIA_DEV_REPO_ROOT: first,
    };
    const a = resolveStackPaths({ environment: shared });
    const b = resolveStackPaths({
      environment: { ...shared, PYTHIA_DEV_REPO_ROOT: second },
    });
    expect(a.id).not.toBe(b.id);
    expect(a.profile).not.toBe(b.profile);
    expect(a.ports).not.toEqual(b.ports);
    expect(a.workspace).not.toBe(b.workspace);
    expect(a.basicMemoryConfig).not.toBe(b.basicMemoryConfig);
    expect(a.dataRoot).not.toBe(b.dataRoot);
    expect(a.cacheRoot).not.toBe(b.cacheRoot);
    expect(a.hermesRoot).toBe(b.hermesRoot);
  });

  it("derives stable lowercase profiles and deterministic non-overlapping ports", () => {
    const identity = stackIdentity("/tmp/Example Worktree");
    expect(identity).toEqual(stackIdentity("/tmp/Example Worktree"));
    expect(identity.profile).toMatch(/^pythia-[a-f0-9]{12}$/u);
    expect(new Set(Object.values(identity.ports)).size).toBe(4);
    // Every stack's three consecutive ports fall below 43000, so no stack's
    // settings server can take another stack's Hermes, memory or Desk port.
    expect(Math.max(identity.ports.hermes, identity.ports.desk)).toBeLessThan(
      43000,
    );
    expect(identity.ports.settings).toBeGreaterThanOrEqual(43000);
    expect(identity.ports.settings).toBeLessThan(50000);
  });

  it("rejects a profile root that would disable Hermes loop liveness", () => {
    const paths = developmentPaths(
      join(temporaryRoot(), "an-extremely-long-segment".repeat(5)),
    );
    expect(() => assertHermesRuntimePath(paths, "darwin")).toThrow(
      /too long.*loop-liveness socket/u,
    );
  });

  it("constructs only the qualified native commands", () => {
    const paths = developmentPaths();
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
    for (const action of ["add", "status", "logout"]) {
      expect(nativeRootAuthArguments(action, "openai-codex")).not.toContain(
        "-p",
      );
    }
  });

  it("seeds native terminal.cwd once, reads it back, and preserves an override", () => {
    const root = temporaryRoot();
    const paths = developmentPaths(root);
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
    const paths = developmentPaths();
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
