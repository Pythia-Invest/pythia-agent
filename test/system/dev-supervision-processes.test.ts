import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson, readJson } from "../../scripts/dev/files.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import {
  requestHermesRestart,
  stackStatus,
  stopStack,
} from "../../scripts/dev/supervisor.mjs";
import {
  startFixture,
  temporaryRoot,
  waitUntil,
} from "../support/dev-stack.js";

describe("foreground supervision process ownership", () => {
  it("starts two independent stacks and stops only the selected owner", async () => {
    const firstRoot = temporaryRoot();
    const secondRoot = temporaryRoot();
    const firstRepo = join(firstRoot, "repo");
    const secondRepo = join(secondRoot, "repo");
    mkdirSync(firstRepo);
    mkdirSync(secondRepo);
    const sharedRoot = temporaryRoot();
    const first = startFixture(sharedRoot, {
      PYTHIA_DEV_REPO_ROOT: firstRepo,
    });
    const second = startFixture(sharedRoot, {
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
    const fixture = startFixture(root, {
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
    const fixture = startFixture(root);
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
    const fixture = startFixture(root, {
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
    const fixture = startFixture(root, {
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
    const fixture = startFixture(root, {
      PYTHIA_TEST_FAIL_SERVICE: "memory",
    });
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(existsSync(fixture.paths.receipt)).toBe(false);
    await assertPortsFree(fixture.paths.ports);
  });
});
