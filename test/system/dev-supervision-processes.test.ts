import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJson, readJson } from "../../scripts/dev/files.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import {
  resetDerivedDevelopmentState,
  requestHermesRestart,
  stackStatus,
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

describe("foreground supervision process ownership", () => {
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
    const rejectedRestart = expect(restart).rejects.toThrow(
      /foreground supervisor (?:stopped|identity changed)/u,
    );
    await waitUntil(() => {
      if (!existsSync(fixture.paths.receipt)) return false;
      return readJson(fixture.paths.receipt).hermes_restarting === true;
    });
    process.kill(-memory.pid, "SIGTERM");
    await rejectedRestart;
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(existsSync(fixture.paths.receipt)).toBe(false);
    await assertPortsFree(fixture.paths.ports);
  }, 20_000);

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
