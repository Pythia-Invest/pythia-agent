import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/dev/files.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import {
  resetDerivedDevelopmentState,
  requestHermesRestart,
  supervise,
  validateReceipt,
} from "../../scripts/dev/supervisor.mjs";
import {
  waitForHermesPortRelease,
  waitForNoReuseAddressPortRelease,
} from "../../scripts/dev/supervisor-processes.mjs";
import {
  developmentPaths,
  ownChild,
  ownServer,
  temporaryRoot,
  waitUntil,
} from "../support/dev-stack";

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

    const occupied = ownServer(createServer());
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

  it("runs the lifecycle probe from the prepared Hermes interpreter without a legacy environment", async () => {
    const root = temporaryRoot();
    const paths = developmentPaths(root);
    const bin = join(paths.hermesSource, ".venv", "bin");
    mkdirSync(bin, { recursive: true });
    const marker = join(root, "hermes-python-invoked");
    const python = join(bin, "python");
    writeFileSync(
      python,
      `#!/usr/bin/env python3
import os
import sys
from pathlib import Path
Path(${JSON.stringify(marker)}).write_text("invoked")
os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
`,
      { mode: 0o700 },
    );
    const available = createServer();
    await new Promise<void>((resolve) =>
      available.listen(0, "127.0.0.1", resolve),
    );
    const address = available.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture port");
    await new Promise<void>((resolve) => available.close(() => resolve()));
    paths.ports.hermes = address.port;

    await expect(waitForHermesPortRelease(paths)).resolves.toBeUndefined();
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(paths.legacyPython)).toBe(false);

    rmSync(marker);
    const occupied = ownServer(createServer());
    await new Promise<void>((resolve) =>
      occupied.listen(address.port, "127.0.0.1", resolve),
    );
    const controller = new AbortController();
    const waiting = waitForHermesPortRelease(paths, {
      signal: controller.signal,
    });
    const cancelled = expect(waiting).rejects.toThrow(
      /cancelled while stopping/u,
    );
    try {
      await waitUntil(() => existsSync(marker));
    } finally {
      controller.abort();
    }
    await cancelled;

    rmSync(python);
    await expect(waitForHermesPortRelease(paths)).rejects.toThrow(
      `could not run the pinned Python interpreter ${python}`,
    );
  });

  it("fails actionably instead of taking over a foreign listener", async () => {
    const paths = developmentPaths();
    const server = ownServer(createServer());
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
    const paths = developmentPaths();
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

    const sleeper = ownChild(
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
    );
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
    // Setting aside such a receipt on stop is covered by dev-stale-receipt.
    await expect(requestHermesRestart(paths, 500)).rejects.toThrow(
      /supervisor receipt is stale or foreign/u,
    );
    expect(processIdentity(sleeperPid)).not.toBeNull();

    // A receipt whose supervisor still runs is never set aside or signalled.
    atomicWriteJson(paths.receipt, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      supervisor: { ...identity, pid: sleeperPid },
      children: [
        { name: "hermes", ...identity, command_sha256: "0".repeat(64) },
      ],
    });
    expect(() => resetDerivedDevelopmentState(paths)).toThrow(
      /running receipt/u,
    );
    expect(existsSync(paths.receipt)).toBe(true);
    expect(processIdentity(sleeperPid)).not.toBeNull();
  });
});
