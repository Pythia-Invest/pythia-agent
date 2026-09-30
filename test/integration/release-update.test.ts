import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  atomicWriteJson,
  copyPrivateFile,
  readJson,
} from "../../scripts/install/files.mjs";
import { assertInstallationSource } from "../../scripts/install/runtime.mjs";
import { applyUpdate, recoverUpdate } from "../../scripts/update/apply.mjs";
import {
  compareStableTags,
  discoverRelease,
  releaseStatus,
  verifyStableTag,
} from "../../scripts/update/release.mjs";

import {
  run,
  commit,
  signedTag,
  releaseFixture,
} from "../support/release-fixture.js";
// The recovery path a test resumes; recoverUpdate may also return an applied update.
type Recovered = Extract<
  Awaited<ReturnType<typeof recoverUpdate>>,
  { recovered: boolean }
>;

describe("release verification and update", () => {
  it("orders strict stable tags and verifies annotated SSH tags", () => {
    const fixture = releaseFixture();
    expect(compareStableTags("v1.10.0", "v1.2.9")).toBeGreaterThan(0);
    expect(
      verifyStableTag(fixture.checkout, "v0.1.0", fixture.paths.allowedSigners),
    ).toBe(fixture.revisionA);
    // A lightweight stable tag carries no signature to verify.
    run(fixture.source, ["git", "tag", "v0.2.1"]);
    run(fixture.source, ["git", "tag", "-a", "release-b", "-m", "release-b"]);
    for (const [tag, code] of [
      ["v0.2.1", "unsigned_tag"],
      ["release-b", "invalid_tag"],
    ]) {
      expect(() =>
        verifyStableTag(fixture.source, tag, fixture.paths.allowedSigners),
      ).toThrow(expect.objectContaining({ code }));
    }
  });

  it("discovers the peeled commit without changing checkout refs or worktree", () => {
    const fixture = releaseFixture();
    const refsBefore = run(fixture.checkout, ["git", "show-ref"]);
    const statusBefore = run(fixture.checkout, [
      "git",
      "status",
      "--porcelain",
    ]);
    expect(
      assertInstallationSource(fixture.paths, "stable", fixture.revisionA, {
        allowLocal: true,
      }),
    ).toBe(fixture.revisionA);
    expect(discoverRelease(fixture.paths)).toMatchObject({
      channel: "stable",
      current_revision: fixture.revisionA,
      target_revision: fixture.revisionB,
      target_version: "v0.2.0",
      update_available: true,
      trust: "verified",
    });
    expect(run(fixture.checkout, ["git", "show-ref"])).toBe(refsBefore);
    expect(run(fixture.checkout, ["git", "status", "--porcelain"])).toBe(
      statusBefore,
    );
  });

  it("fails closed when installed trust is empty or the checkout is dirty", () => {
    const fixture = releaseFixture();
    writeFileSync(fixture.paths.allowedSigners, "# no signer yet\n", {
      mode: 0o600,
    });
    expect(releaseStatus(fixture.paths)).toMatchObject({
      status: "unavailable",
      code: "trust_root_empty",
    });
    copyPrivateFile(
      join(fixture.checkout, "release", "allowed_signers"),
      fixture.paths.allowedSigners,
    );
    writeFileSync(join(fixture.checkout, "local-edit.txt"), "fork\n");
    expect(discoverRelease(fixture.paths)).toMatchObject({
      checkout_clean: false,
    });
  });

  it("uses explicit main for preview and rejects another local branch", () => {
    const fixture = releaseFixture();
    run(fixture.checkout, ["git", "checkout", "main"]);
    run(fixture.checkout, ["git", "reset", "--hard", fixture.revisionA]);
    atomicWriteJson(fixture.paths.releaseFile, {
      schema_version: 1,
      channel: "preview",
    });
    atomicWriteJson(fixture.paths.installFile, {
      schema_version: 1,
      checkout: fixture.checkout,
      channel: "preview",
      revision: fixture.revisionA,
    });
    expect(discoverRelease(fixture.paths)).toMatchObject({
      channel: "preview",
      target_revision: fixture.revisionB,
      update_available: true,
      trust: "preview-unsigned",
    });
    run(fixture.checkout, ["git", "checkout", "-b", "local-fork"]);
    expect(releaseStatus(fixture.paths)).toMatchObject({
      status: "unavailable",
      code: "preview_branch_invalid",
    });
  });

  it("rejects a newer release signed by an unknown key", () => {
    const fixture = releaseFixture();
    const unknown = join(fixture.root, "unknown-key");
    run(fixture.root, [
      "ssh-keygen",
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      unknown,
    ]);
    writeFileSync(join(fixture.source, "version.txt"), "C\n");
    commit(fixture.source, "untrusted release");
    signedTag(fixture.source, unknown, "v0.3.0");
    run(fixture.source, ["git", "push", "origin", "main", "--tags"]);
    expect(releaseStatus(fixture.paths)).toMatchObject({
      status: "unavailable",
      code: "untrusted_tag",
    });
  });

  it("applies only a verified fast-forward and records health-confirmed completion", async () => {
    const fixture = releaseFixture();
    const actions: string[] = [];
    const result = await applyUpdate(fixture.paths, {
      stop: async () => actions.push("stop"),
      completeCandidate: async () => {
        actions.push("prepare");
      },
      startAndVerify: async () => actions.push("start-and-health"),
      enable: async () => {
        expect(readJson(fixture.paths.installFile).revision).toBe(
          fixture.revisionB,
        );
        expect(
          readJson(join(fixture.paths.transactionRoot, "active.json")),
        ).toMatchObject({ phase: "complete", services: "running" });
        actions.push("enable");
      },
    });
    expect(result.updated).toBe(true);
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionB,
    );
    expect(actions).toEqual(["stop", "prepare", "start-and-health", "enable"]);
    const receipt = readJson(
      join(fixture.paths.transactionRoot, "active.json"),
    );
    expect(receipt).toMatchObject({
      old_revision: fixture.revisionA,
      new_revision: fixture.revisionB,
      phase: "complete",
      services: "running",
    });
    expect(
      receipt.history.map((entry: { phase: string }) => entry.phase),
    ).toEqual(
      expect.arrayContaining([
        "stopping",
        "stopped",
        "source-updated",
        "prepared",
        "complete",
      ]),
    );
  });

  it("re-enters a complete-before-enable boundary through explicit recovery", async () => {
    const fixture = releaseFixture();
    let enableBoundaryObserved = false;
    await applyUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
      enable: async () => {
        enableBoundaryObserved = true;
        expect(
          readJson(join(fixture.paths.transactionRoot, "active.json")),
        ).toMatchObject({ phase: "complete" });
      },
    });
    expect(enableBoundaryObserved).toBe(true);
    const recoveredStart = vi.fn(async () => undefined);
    const recoveredStop = vi.fn(async () => undefined);
    const recoveredEnable = vi.fn(async () => undefined);
    await expect(
      recoverUpdate(fixture.paths, {
        stop: recoveredStop,
        startAndVerify: recoveredStart,
        enable: recoveredEnable,
      }),
    ).resolves.toMatchObject({ recovered: true });
    expect(recoveredStop).toHaveBeenCalledTimes(1);
    expect(recoveredStart).toHaveBeenCalledTimes(1);
    expect(recoveredEnable).toHaveBeenCalledTimes(1);
  });

  it("leaves complete-boundary recovery stopped when readiness fails", async () => {
    const fixture = releaseFixture();
    await applyUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
      enable: async () => undefined,
    });
    const stop = vi.fn(async () => undefined);
    await expect(
      recoverUpdate(fixture.paths, {
        stop,
        startAndVerify: async () => {
          throw new Error("synthetic recovery health failure");
        },
        enable: async () => undefined,
      }),
    ).rejects.toThrow("synthetic recovery health failure");
    expect(stop).toHaveBeenCalledTimes(2);
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({ phase: "failed-stopped", services: "stopped" });
  });

  it("detects an edit after stop and leaves the old revision stopped", async () => {
    const fixture = releaseFixture();
    const actions: string[] = [];
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => actions.push("stop"),
        afterStop: async () =>
          writeFileSync(join(fixture.checkout, "late-edit.txt"), "late\n"),
        completeCandidate: async () => actions.push("prepare"),
        startAndVerify: async () => actions.push("start"),
      }),
    ).rejects.toMatchObject({ code: "dirty_checkout" });
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionA,
    );
    expect(actions).toEqual(["stop", "stop"]);
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({ phase: "failed-stopped", services: "stopped" });

    rmSync(join(fixture.checkout, "late-edit.txt"));
    writeFileSync(join(fixture.source, "version.txt"), "C\n");
    commit(fixture.source, "release C");
    signedTag(fixture.source, fixture.key, "v0.3.0");
    run(fixture.source, ["git", "push", "origin", "main", "--tags"]);
    await recoverUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
    });
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionB,
    );
  });

  it("rejects a post-merge mutation before candidate code or services run", async () => {
    const fixture = releaseFixture();
    const actions: string[] = [];
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => actions.push("stop"),
        afterMerge: async () =>
          writeFileSync(
            join(fixture.checkout, "post-merge-edit.txt"),
            "late\n",
          ),
        completeCandidate: async () => actions.push("prepare"),
        startAndVerify: async () => actions.push("start"),
      }),
    ).rejects.toMatchObject({ code: "dirty_checkout" });
    expect(actions).toEqual(["stop", "stop"]);
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionB,
    );
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({ phase: "failed-stopped", services: "stopped" });
  });

  it("adds a signer, later removes the old signer, and recovers idempotently", async () => {
    const fixture = releaseFixture();
    const nextKey = join(fixture.root, "next-release-key");
    run(fixture.root, [
      "ssh-keygen",
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      nextKey,
    ]);
    const oldSigner = readFileSync(
      join(fixture.source, "release", "allowed_signers"),
      "utf8",
    );
    const nextPublic = readFileSync(`${nextKey}.pub`, "utf8").trim();
    const nextSigner = `next@test.invalid namespaces="git" ${nextPublic}\n`;

    writeFileSync(
      join(fixture.source, "release", "allowed_signers"),
      `${oldSigner}${nextSigner}`,
    );
    writeFileSync(join(fixture.source, "version.txt"), "C\n");
    const revisionC = commit(fixture.source, "add next release signer");
    signedTag(fixture.source, fixture.key, "v0.3.0");
    run(fixture.source, ["git", "push", "origin", "main", "--tags"]);
    await applyUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
    });
    expect(readFileSync(fixture.paths.allowedSigners, "utf8")).toContain(
      "next@test.invalid",
    );
    expect(readJson(fixture.paths.installFile).revision).toBe(revisionC);

    writeFileSync(
      join(fixture.source, "release", "allowed_signers"),
      nextSigner,
    );
    writeFileSync(join(fixture.source, "version.txt"), "D\n");
    const revisionD = commit(fixture.source, "remove old release signer");
    signedTag(fixture.source, nextKey, "v0.4.0");
    run(fixture.source, ["git", "push", "origin", "main", "--tags"]);
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: async () => {
          throw new Error("synthetic failure after trust refresh");
        },
        startAndVerify: async () => undefined,
      }),
    ).rejects.toThrow("synthetic failure after trust refresh");
    expect(readFileSync(fixture.paths.allowedSigners, "utf8")).toBe(nextSigner);
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(revisionD);

    const recovered = (await recoverUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
    })) as Recovered;
    expect(recovered.receipt.phase).toBe("complete");
    expect(readFileSync(fixture.paths.allowedSigners, "utf8")).toBe(nextSigner);
    expect(readJson(fixture.paths.installFile).revision).toBe(revisionD);
  });

  it("resumes a post-checkout failure from the immutable receipt", async () => {
    const fixture = releaseFixture();
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: async () => {
          throw new Error("synthetic dependency failure");
        },
        startAndVerify: async () => undefined,
      }),
    ).rejects.toThrow("synthetic dependency failure");
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionB,
    );
    const recovered = (await recoverUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
    })) as Recovered;
    expect(recovered.recovered).toBe(true);
    expect(recovered.receipt.phase).toBe("complete");
    const transactionPath = join(
      fixture.paths.transactionRoot,
      `${recovered.receipt.transaction_id}.json`,
    );
    expect(readJson(transactionPath).history.length).toBeGreaterThan(4);
  });

  it("records an unconfirmed stop when target-revision recovery cannot stop", async () => {
    const fixture = releaseFixture();
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: async () => {
          throw new Error("synthetic preparation failure");
        },
      }),
    ).rejects.toThrow("synthetic preparation failure");

    await expect(
      recoverUpdate(fixture.paths, {
        stop: async () => {
          throw new Error("synthetic stop failure");
        },
        completeCandidate: async () => undefined,
        startAndVerify: async () => undefined,
      }),
    ).rejects.toThrow("synthetic stop failure");
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({
      phase: "failed-stopped",
      services: "stop-unconfirmed",
    });
  });
});
