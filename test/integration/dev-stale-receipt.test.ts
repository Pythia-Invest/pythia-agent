import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/dev/files.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import {
  initializeDevelopmentRuntime,
  stopStack,
} from "../../scripts/dev/supervisor.mjs";
import { developmentPaths, ownChild } from "../support/dev-stack";

function stack() {
  const paths = developmentPaths();
  mkdirSync(paths.processRoot, { recursive: true, mode: 0o700 });
  return paths;
}

/** The identity a process had while it ran, captured before it exits. */
async function exitedIdentity() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const deadline = Date.now() + 5_000;
  let identity = null;
  while (!identity && Date.now() < deadline) {
    identity = child.pid ? processIdentity(child.pid) : null;
    if (!identity) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!identity) throw new Error("The fixture process never became visible.");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
  return identity;
}

function writeReceipt(
  paths: ReturnType<typeof stack>,
  supervisor: unknown,
  children: unknown[],
) {
  atomicWriteJson(paths.receipt, {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    hermes_root: paths.hermesRoot,
    state_root: paths.stateRoot,
    supervisor,
    children,
  });
  return readFileSync(paths.receipt, "utf8");
}

const retiredReceipts = (paths: ReturnType<typeof stack>) =>
  readdirSync(paths.processRoot).filter((name) =>
    name.startsWith("foreground.json.stale-"),
  );

describe("development receipt left by an exited supervisor", () => {
  it("is set aside, not deleted, once every recorded process has exited", async () => {
    const paths = stack();
    const recorded = writeReceipt(paths, await exitedIdentity(), [
      { name: "hermes", ...(await exitedIdentity()) },
    ]);
    await expect(
      initializeDevelopmentRuntime(paths, { prepareRuntime: () => "prepared" }),
    ).resolves.toBe("prepared");
    expect(existsSync(paths.receipt)).toBe(false);
    const [retired] = retiredReceipts(paths);
    expect(readFileSync(join(paths.processRoot, retired), "utf8")).toBe(
      recorded,
    );
    expect(existsSync(paths.preparationAdmission)).toBe(false);
  });

  it("treats a PID now held by a different process as exited", async () => {
    const paths = stack();
    const live = processIdentity(process.pid);
    writeReceipt(paths, { ...live, command_sha256: "0".repeat(64) }, [
      { name: "desk", ...(await exitedIdentity()) },
    ]);
    await expect(stopStack(paths)).resolves.toMatchObject({
      stopped: false,
      reason: "already-exited",
    });
    expect(existsSync(paths.receipt)).toBe(false);
    expect(retiredReceipts(paths)).toHaveLength(1);
  });

  it.each([
    ["the supervisor", true],
    ["a child", false],
  ])(
    "stays authoritative while %s may still run",
    async (_, liveSupervisor) => {
      const paths = stack();
      const live = processIdentity(process.pid);
      const exited = await exitedIdentity();
      const recorded = writeReceipt(paths, liveSupervisor ? live : exited, [
        { name: "hermes", ...(liveSupervisor ? exited : live) },
      ]);
      await expect(
        initializeDevelopmentRuntime(paths, {
          prepareRuntime: () => "prepared",
        }),
      ).rejects.toThrow(/foreground owner already exists/u);
      expect(readFileSync(paths.receipt, "utf8")).toBe(recorded);
      expect(retiredReceipts(paths)).toEqual([]);
      expect(existsSync(paths.preparationAdmission)).toBe(false);
    },
  );
});

/**
 * A process group leader that runs until signalled and, given a port, holds it
 * on loopback.
 */
async function listeningChild(port?: number) {
  const child = ownChild(
    spawn(
      process.execPath,
      [
        "-e",
        port === undefined
          ? `setInterval(() => {}, 1000); console.log("ready")`
          : `require("node:net").createServer().listen(${port}, "127.0.0.1", () => console.log("ready"))`,
      ],
      { stdio: ["ignore", "pipe", "ignore"], detached: true },
    ),
  );
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  await new Promise((resolve) => child.stdout?.once("data", resolve));
  const identity = processIdentity(child.pid as number);
  if (!identity) throw new Error("The fixture process is not visible.");
  return { child, identity, exited };
}

describe("development stack whose supervisor exited but left children running", () => {
  it("stops a child whose identity matches the receipt, frees its port and retires the receipt", async () => {
    const paths = stack();
    const orphan = await listeningChild(paths.ports.desk);
    const recorded = writeReceipt(paths, await exitedIdentity(), [
      { name: "desk", ...orphan.identity },
    ]);
    await expect(assertPortsFree(paths.ports)).rejects.toThrow(/desk port/u);

    const result = await stopStack(paths);

    expect(result).toMatchObject({
      stopped: true,
      reason: "supervisor-exited",
      terminated: [{ name: "desk", pid: orphan.identity.pid }],
    });
    await orphan.exited;
    await assertPortsFree(paths.ports);
    expect(existsSync(paths.receipt)).toBe(false);
    const [retired] = retiredReceipts(paths);
    expect(readFileSync(join(paths.processRoot, retired), "utf8")).toBe(
      recorded,
    );
  });

  it("never signals a recorded PID whose live identity differs from the receipt", async () => {
    const paths = stack();
    const orphan = await listeningChild(paths.ports.desk);
    const reused = await listeningChild();
    writeReceipt(paths, await exitedIdentity(), [
      { name: "desk", ...orphan.identity },
      // Same PID, another start time: the recorded process is long gone.
      {
        name: "hermes-settings",
        ...reused.identity,
        started: "Mon Jan  1 00:00:00 2001",
      },
    ]);

    await expect(stopStack(paths)).resolves.toMatchObject({
      stopped: true,
      terminated: [{ name: "desk", pid: orphan.identity.pid }],
    });

    await orphan.exited;
    expect(processIdentity(reused.identity.pid)).toEqual(reused.identity);
    expect(reused.child.exitCode).toBeNull();
    expect(reused.child.signalCode).toBeNull();
    expect(existsSync(paths.receipt)).toBe(false);
  });
});
