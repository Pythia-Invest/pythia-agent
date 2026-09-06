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
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJson } from "../../scripts/dev/files.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import {
  requestHermesRestart,
  requestRuntimeRefresh,
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

describe("foreground supervision refresh", () => {
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
});
