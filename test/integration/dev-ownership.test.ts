import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/dev/files.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import {
  resetDerivedDevelopmentState,
  requestHermesRestart,
  supervise,
  stopStack,
  validateReceipt,
  waitForNoReuseAddressPortRelease,
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
