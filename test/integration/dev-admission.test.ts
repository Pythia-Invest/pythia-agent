import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/dev/files.mjs";
import {
  initializeDevelopmentRuntime,
  resetDerivedDevelopmentState,
  requestRuntimeRefresh,
  runDevelopment,
} from "../../scripts/dev/supervisor.mjs";
import { developmentPaths } from "../support/dev-stack.js";

describe("development preparation admission", () => {
  it("serializes real development entrypoints and releases failed preparation", async () => {
    const paths = developmentPaths();
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

  it("prepares an explicitly refreshed stopped stack without starting services", async () => {
    const paths = developmentPaths();
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

  it("resets only current derived state and preserves user-owned roots", () => {
    const paths = developmentPaths();
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
    const staleOwner = {
      pid: 999_999_999,
      started: "never",
      command_sha256: "0".repeat(64),
    };
    atomicWriteJson(paths.preparationAdmission, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      state_root: paths.stateRoot,
      operation: "stale fixture preparation",
      owner: staleOwner,
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
      owner: staleOwner,
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
