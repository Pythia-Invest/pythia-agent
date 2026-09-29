import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/dev/files.mjs";
import { processIdentity } from "../../scripts/dev/processes.mjs";
import {
  initializeDevelopmentRuntime,
  stopStack,
} from "../../scripts/dev/supervisor.mjs";
import { developmentPaths } from "../support/dev-stack";

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
