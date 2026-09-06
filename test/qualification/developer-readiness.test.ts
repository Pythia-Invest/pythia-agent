import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import {
  assertHermesRuntimePath,
  prepareManagedRuntime,
} from "../../scripts/dev/runtime.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import { rebuildDevice } from "../../scripts/install/runtime.mjs";
import { applyUpdate } from "../../scripts/update/apply.mjs";
import {
  cleanupAssembledFixture,
  instrumentContextProbe,
  prepareAssembledFixture,
  qualificationCacheEnvironment,
  requestJson,
  SETTINGS_MUTATION_TIMEOUT_MS,
} from "../../tooling/qualification/assembled-readiness.mjs";
import {
  cleanupReleaseFixtures,
  createExactSourceFixture,
  git,
  repositoryRoot,
  temporaryQualificationRoot,
} from "../support/release-snapshot";

afterEach(cleanupReleaseFixtures);

function run(
  cwd: string,
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function hash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function privateFile(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { mode: 0o600 });
}

describe("assembled developer readiness", () => {
  it("keeps short observations while allowing the bounded settings mutation budget", async () => {
    const server = http.createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ready":true}');
      }, 30);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Delayed qualification server did not bind a TCP port.");
    }
    try {
      await expect(
        requestJson({ port: address.port, path: "/within", timeoutMs: 200 }),
      ).resolves.toMatchObject({ body: { ready: true }, status: 200 });
      await expect(
        requestJson({ port: address.port, path: "/timeout", timeoutMs: 5 }),
      ).rejects.toThrow("GET /timeout timed out");
      expect(SETTINGS_MUTATION_TIMEOUT_MS).toBe(220_000);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("activates an exact chosen dirty detached source without Git mutation while automatic update stays strict", async () => {
    const fixture = createExactSourceFixture();
    const checkout = fixture.clone;
    git(checkout, ["checkout", "--detach", fixture.revision]);
    writeFileSync(
      join(checkout, "README.md"),
      `${readFileSync(join(checkout, "README.md"), "utf8")}\nlocal tracked edit\n`,
    );
    writeFileSync(
      join(checkout, "local-untracked.txt"),
      "chosen local source\n",
    );
    expect(
      run(checkout, join(checkout, "scripts/install/preflight.sh"), [
        checkout,
        "preview",
      ]),
    ).toContain("Selected current source");

    const environment = {
      ...process.env,
      HOME: join(fixture.root, "home"),
      PYTHIA_CHECKOUT: checkout,
      PYTHIA_INSTALL_BIN_HOME: join(fixture.root, "home/.local/bin"),
      PYTHIA_INSTALL_CACHE_HOME: join(fixture.root, "cache"),
      PYTHIA_INSTALL_CONFIG_HOME: join(fixture.root, "config"),
      PYTHIA_INSTALL_DATA_HOME: join(fixture.root, "data"),
      PYTHIA_INSTALL_STATE_HOME: join(fixture.root, "state"),
      PYTHIA_INSTALL_SYSTEMD_HOME: join(fixture.root, "units"),
    };
    const paths = resolveInstallPaths(environment);
    const preserved = {
      auth: join(paths.configRoot, "hermes/auth.json"),
      choices: join(paths.configRoot, "hermes/profiles/pythia/config.yaml"),
      knowledge: join(paths.knowledge, "qualification.md"),
      session: join(
        paths.configRoot,
        "hermes/profiles/pythia/sessions/qualification.json",
      ),
      settings: join(paths.configRoot, "settings.json"),
      workspace: join(paths.workspace, "qualification.md"),
    };
    privateFile(preserved.auth, '{"synthetic":"oauth-owner"}\n');
    privateFile(
      preserved.choices,
      "skills:\n  disabled: [eodhd-market-data]\n",
    );
    privateFile(preserved.knowledge, "# Synthetic knowledge\n");
    privateFile(preserved.session, '{"id":"synthetic-session"}\n');
    privateFile(preserved.settings, '{"schema_version":1}\n');
    privateFile(preserved.workspace, "Synthetic workspace\n");
    const hashes = Object.fromEntries(
      Object.entries(preserved).map(([name, path]) => [name, hash(path)]),
    );
    atomicWriteJson(paths.releaseFile, {
      schema_version: 1,
      channel: "preview",
    });
    atomicWriteJson(paths.installFile, {
      schema_version: 1,
      checkout,
      channel: "preview",
      revision: fixture.revision,
      source: {
        kind: "release",
        dirty: false,
        branch: "main",
        update_safe: true,
      },
    });
    const refsBefore = git(checkout, ["show-ref"]);
    const headBefore = git(checkout, ["rev-parse", "HEAD"]);
    const statusBefore = git(checkout, ["status", "--porcelain=v1"]);
    const actions: string[] = [];
    const rebuilt = await rebuildDevice(paths, {
      stop: async () => actions.push("disable-stop"),
      prepare: async (
        _paths: unknown,
        _channel: unknown,
        revision: string,
        options: unknown,
      ) => {
        expect(options).toEqual({ allowLocal: true });
        actions.push("shared-prepare");
        return { revision };
      },
      startAndVerify: async () => actions.push("trial-health"),
      enable: async () => actions.push("enable"),
    });
    expect(actions).toEqual([
      "disable-stop",
      "shared-prepare",
      "trial-health",
      "enable",
    ]);
    expect(rebuilt.source).toMatchObject({
      branch: null,
      dirty: true,
      update_safe: false,
    });
    expect(git(checkout, ["show-ref"])).toBe(refsBefore);
    expect(git(checkout, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(git(checkout, ["status", "--porcelain=v1"])).toBe(statusBefore);
    for (const [name, path] of Object.entries(preserved)) {
      expect(hash(path), name).toBe(hashes[name]);
    }
    await expect(applyUpdate(paths)).rejects.toMatchObject({
      code: "dirty_checkout",
    });

    git(checkout, ["restore", "README.md"]);
    rmSync(join(checkout, "local-untracked.txt"));
    await expect(applyUpdate(paths)).rejects.toMatchObject({
      code: "ownership_changed",
    });
    expect(git(checkout, ["rev-parse", "HEAD"])).toBe(headBefore);
  }, 30_000);

  it("installs the changed locked dependency before Pythia's real candidate compiler", async () => {
    const root = temporaryQualificationRoot("dependency-order", "t08");
    const fixture = join(
      repositoryRoot,
      "test/fixtures/dependency-build-order",
    );
    cpSync(fixture, root, { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    copyFileSync(join(root, "package-a.json"), join(root, "package.json"));
    copyFileSync(join(root, "pnpm-lock-a.yaml"), join(root, "pnpm-lock.yaml"));
    copyFileSync(join(root, "source-a.ts"), join(root, "src/index.ts"));
    const environment = {
      ...process.env,
      CI: "1",
      PATH: `${join(repositoryRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      npm_config_offline: "true",
      npm_config_store_dir: join(root, "pnpm-store"),
    };
    run(
      root,
      "pnpm",
      ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
      environment,
    );
    run(root, "pnpm", ["run", "build:runtime"], environment);
    expect(run(root, "node", ["dist/index.js"], environment)).toBe("A");

    copyFileSync(join(root, "package-b.json"), join(root, "package.json"));
    copyFileSync(join(root, "pnpm-lock-b.yaml"), join(root, "pnpm-lock.yaml"));
    copyFileSync(join(root, "source-b.ts"), join(root, "src/index.ts"));
    expect(
      JSON.parse(
        readFileSync(
          join(
            root,
            "node_modules/@pythia/qualification-contract/package.json",
          ),
          "utf8",
        ),
      ).version,
    ).toBe("1.0.0");
    const premature = spawnSync("pnpm", ["run", "build:runtime"], {
      cwd: root,
      encoding: "utf8",
      env: environment,
    });
    expect(premature.status).not.toBe(0);
    expect(`${premature.stdout}\n${premature.stderr}`).toContain(
      "candidateContract",
    );

    const commands: string[] = [];
    const runCommand = (
      command: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => {
      commands.push(`${command} ${args.join(" ")}`);
      if (command === "uv") return "separately-qualified-native-sync";
      return run(
        options.cwd ?? root,
        command,
        args,
        options.env ?? environment,
      );
    };
    const managedPython = join(root, "managed-python");
    mkdirSync(managedPython);
    const paths = resolveStackPaths({
      environment: {
        ...environment,
        PYTHIA_DEV_REPO_ROOT: root,
        PYTHIA_DEV_CONFIG_HOME: join(root, "owners/config"),
        PYTHIA_DEV_STATE_HOME: join(root, "owners/state"),
        PYTHIA_DEV_DATA_HOME: join(root, "owners/data"),
        PYTHIA_DEV_CACHE_HOME: join(root, "owners/cache"),
      },
    });
    await prepareManagedRuntime(
      {
        ...paths,
        hermesSource: join(root, "hermes-source"),
        managedPython,
        managedPythonSource: managedPython,
      },
      {
        ensureHermesSource: async () => undefined,
        environment,
        runCommand,
        sourceContract: {
          install: { command: ["uv", "sync", "--frozen"] },
        },
      },
    );
    expect(commands).toEqual([
      "uv sync --frozen",
      `uv sync --frozen --project ${managedPython}`,
      "pnpm install --frozen-lockfile",
      "pnpm run build:runtime",
    ]);
    expect(
      JSON.parse(
        readFileSync(
          join(
            root,
            "node_modules/@pythia/qualification-contract/package.json",
          ),
          "utf8",
        ),
      ).version,
    ).toBe("2.0.0");
    expect(run(root, "node", ["dist/index.js"], environment)).toBe("B");
  }, 30_000);

  it("prepares an exact two-worktree native qualification fixture without starting stacks", () => {
    const acceleration = qualificationCacheEnvironment(
      { uvBinary: "/qualified/bin/uv", uvCache: "/qualified/cache/uv" },
      "/system/bin",
    );
    expect(acceleration).toEqual({
      PATH: "/qualified/bin:/system/bin",
      UV_CACHE_DIR: "/qualified/cache/uv",
    });
    expect(acceleration).not.toHaveProperty("UV_OFFLINE");
    expect(acceleration).not.toHaveProperty("npm_config_offline");

    const root = temporaryQualificationRoot("assembled-test", "t08");
    rmSync(root, { recursive: true });
    try {
      const assembled = prepareAssembledFixture(root);
      expect(assembled.created_source_commit).toBe(
        "disposable-exact-source-only",
      );
      expect(assembled.qualification_cache).toBe("normal-public-pin-hydration");
      expect(assembled.stacks.one.id).not.toBe(assembled.stacks.two.id);
      expect(assembled.stacks.one.paths.stateRoot).not.toBe(
        assembled.stacks.two.paths.stateRoot,
      );
      expect(assembled.stacks.one.environment.PYTHIA_DEV_CONFIG_HOME).toBe(
        assembled.stacks.two.environment.PYTHIA_DEV_CONFIG_HOME,
      );
      expect(assembled.stacks.one.environment.PYTHIA_DEV_CONFIG_HOME).toBe(
        join(assembled.short_configuration_owner, "c"),
      );
      expect(assembled.short_configuration_owner).toMatch(/^\/tmp\/pq-/u);
      expect(assembled.stacks.one.native_session_id).not.toBe(
        assembled.stacks.two.native_session_id,
      );
      expect(assembled.stacks.one.environment.PYTHIA_DEV_STATE_HOME).toContain(
        root,
      );
      expect(assembled.stacks.one.environment.PYTHIA_DEV_DATA_HOME).toContain(
        root,
      );
      expect(assembled.stacks.one.environment.PYTHIA_DEV_CACHE_HOME).toContain(
        root,
      );
      expect(existsSync(assembled.stacks.one.paths.receipt)).toBe(false);
      expect(existsSync(assembled.stacks.two.paths.receipt)).toBe(false);
      expect(assembled.stacks.one.paths.hermesSource).toBe(
        join(
          assembled.stacks.one.environment.PYTHIA_DEV_CACHE_HOME,
          "pythia/dev",
          assembled.stacks.one.id,
          "hermes-source",
        ),
      );
      assertHermesRuntimePath(assembled.stacks.one.paths, "darwin");
      assertHermesRuntimePath(assembled.stacks.two.paths, "darwin");

      const instrumented = instrumentContextProbe(root, "one");
      expect(instrumented.provider_or_model_call).toBe(false);
      expect(instrumented.context_tool).toBe(
        "pythia_qualification_context_probe",
      );
      expect(
        readFileSync(
          join(
            assembled.stacks.one.worktree,
            "runtime/managed/plugin/plugin.yaml",
          ),
          "utf8",
        ),
      ).toContain(instrumented.context_tool);
      expect(
        readFileSync(
          join(
            assembled.stacks.one.worktree,
            "runtime/managed/plugin/__init__.py",
          ),
          "utf8",
        ),
      ).toContain("BEGIN PYTHIA T08 DISPOSABLE CONTEXT PROBE");
    } finally {
      if (existsSync(join(root, "fixture.json"))) {
        const shortOwner = JSON.parse(
          readFileSync(join(root, "fixture.json"), "utf8"),
        ).short_configuration_owner;
        expect(cleanupAssembledFixture(root)).toEqual({
          cleaned: true,
          existed: true,
        });
        expect(existsSync(shortOwner)).toBe(false);
      }
    }
  }, 30_000);
});
