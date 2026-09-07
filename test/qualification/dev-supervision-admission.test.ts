import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJson, readJson } from "../../scripts/dev/files.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import { runtimeCommands } from "../../scripts/dev/runtime.mjs";
import {
  initializeDevelopmentRuntime,
  resetDerivedDevelopmentState,
  requestRuntimeRefresh,
  runDevelopment,
  supervise,
  stopStack,
} from "../../scripts/dev/supervisor.mjs";
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
});
