import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  atomicWriteJson,
  copyPrivateFile,
  readJson,
} from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import {
  assertInstallationSource,
  rebuildDevice,
} from "../../scripts/install/runtime.mjs";
import { applyUpdate, recoverUpdate } from "../../scripts/update/apply.mjs";
import {
  compareStableTags,
  discoverRelease,
  releaseStatus,
  verifyStableTag,
} from "../../scripts/update/release.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(cwd: string, args: string[]) {
  return execFileSync(args[0] ?? "", args.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "pythia-release-test-"));
  roots.push(root);
  return root;
}

function commit(repository: string, message: string) {
  run(repository, ["git", "add", "."]);
  run(repository, ["git", "commit", "-m", message]);
  return run(repository, ["git", "rev-parse", "HEAD"]);
}

function signedTag(repository: string, key: string, tag: string) {
  run(repository, [
    "git",
    "-c",
    "gpg.format=ssh",
    "-c",
    `user.signingkey=${key}`,
    "tag",
    "-s",
    tag,
    "-m",
    tag,
  ]);
}

function releaseFixture() {
  const root = temporaryRoot();
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const checkout = join(root, "checkout");
  const key = join(root, "release-key");
  mkdirSync(source);
  run(root, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key]);
  const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
  run(source, ["git", "init", "-b", "main"]);
  run(source, ["git", "config", "user.name", "Pythia test"]);
  run(source, ["git", "config", "user.email", "release@test.invalid"]);
  mkdirSync(join(source, "release"));
  writeFileSync(
    join(source, "release", "allowed_signers"),
    `release@test.invalid namespaces="git" ${publicKey}\n`,
  );
  writeFileSync(join(source, "version.txt"), "A\n");
  const revisionA = commit(source, "release A");
  signedTag(source, key, "v0.1.0");
  writeFileSync(join(source, "version.txt"), "B\n");
  const revisionB = commit(source, "release B");
  signedTag(source, key, "v0.2.0");
  run(root, ["git", "init", "--bare", remote]);
  run(source, ["git", "remote", "add", "origin", remote]);
  run(source, ["git", "push", "origin", "main", "--tags"]);
  run(root, ["git", "clone", remote, checkout]);
  run(checkout, ["git", "checkout", "-b", "installed-v0.1.0", "v0.1.0"]);

  const environment = {
    ...process.env,
    HOME: join(root, "home"),
    PYTHIA_CHECKOUT: checkout,
    PYTHIA_INSTALL_BIN_HOME: join(root, "home", ".local", "bin"),
    PYTHIA_INSTALL_CACHE_HOME: join(root, "cache"),
    PYTHIA_INSTALL_CONFIG_HOME: join(root, "config"),
    PYTHIA_INSTALL_DATA_HOME: join(root, "data"),
    PYTHIA_INSTALL_STATE_HOME: join(root, "state"),
    PYTHIA_INSTALL_SYSTEMD_HOME: join(root, "units"),
  };
  const paths = resolveInstallPaths(environment);
  mkdirSync(paths.configRoot, { recursive: true, mode: 0o700 });
  mkdirSync(paths.trustRoot, { recursive: true, mode: 0o700 });
  mkdirSync(paths.transactionRoot, { recursive: true, mode: 0o700 });
  copyPrivateFile(
    join(checkout, "release", "allowed_signers"),
    paths.allowedSigners,
  );
  atomicWriteJson(paths.releaseFile, { schema_version: 1, channel: "stable" });
  atomicWriteJson(paths.installFile, {
    schema_version: 1,
    checkout,
    channel: "stable",
    revision: revisionA,
  });
  return { checkout, key, paths, revisionA, revisionB, root, source };
}

describe("release verification and update", () => {
  it("orders strict stable tags and verifies annotated SSH tags", () => {
    const fixture = releaseFixture();
    expect(compareStableTags("v1.10.0", "v1.2.9")).toBeGreaterThan(0);
    expect(
      verifyStableTag(fixture.checkout, "v0.1.0", fixture.paths.allowedSigners),
    ).toBe(fixture.revisionA);
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

    const recovered = await recoverUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
    });
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
    const recovered = await recoverUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: async () => undefined,
      startAndVerify: async () => undefined,
    });
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

describe("installation source preflight", () => {
  it("keeps stable verification strict and accepts an explicit chosen preview source", () => {
    const fixture = releaseFixture();
    run(fixture.source, ["git", "checkout", "main"]);
    expect(
      run(fixture.source, [
        join(repositoryRoot, "scripts", "install", "preflight.sh"),
        fixture.source,
        "stable",
      ]),
    ).toContain("Selected stable release v0.2.0");
    expect(
      run(fixture.source, [
        join(repositoryRoot, "scripts", "install", "preflight.sh"),
        fixture.source,
        "preview",
      ]),
    ).toContain("Selected current source");
  });

  it("rejects invalid stable source but accepts dirty and detached preview source", () => {
    const fixture = releaseFixture();
    run(fixture.source, ["git", "checkout", "main"]);
    writeFileSync(
      join(fixture.source, "release", "allowed_signers"),
      "# pending\n",
    );
    commit(fixture.source, "empty trust");
    run(fixture.source, ["git", "tag", "v0.3.0"]);
    expect(() =>
      run(fixture.source, [
        join(repositoryRoot, "scripts", "install", "preflight.sh"),
        fixture.source,
        "stable",
      ]),
    ).toThrow();
    writeFileSync(join(fixture.source, "dirty.txt"), "dirty\n");
    writeFileSync(join(fixture.source, "version.txt"), "locally edited\n");
    expect(
      run(fixture.source, [
        join(repositoryRoot, "scripts", "install", "preflight.sh"),
        fixture.source,
        "preview",
      ]),
    ).toContain("Selected current source");
    run(fixture.source, ["git", "checkout", "--detach"]);
    expect(
      run(fixture.source, [
        join(repositoryRoot, "scripts", "install", "preflight.sh"),
        fixture.source,
        "preview",
      ]),
    ).toContain("Selected current source");
  });

  it("rechecks the verified HEAD and clean tree after preparation work", () => {
    const fixture = releaseFixture();
    expect(
      assertInstallationSource(fixture.paths, "stable", fixture.revisionA),
    ).toBe(fixture.revisionA);

    run(fixture.checkout, ["git", "checkout", "--detach", "v0.2.0"]);
    expect(() =>
      assertInstallationSource(fixture.paths, "stable", fixture.revisionA),
    ).toThrow("revision changed");

    run(fixture.checkout, ["git", "checkout", "--detach", "v0.1.0"]);
    writeFileSync(join(fixture.checkout, "hydration-edit.txt"), "late\n");
    expect(() =>
      assertInstallationSource(fixture.paths, "stable", fixture.revisionA),
    ).toThrow("became dirty");
  });

  it("rebuilds the exact chosen dirty branch without fetching or reconciling Git", async () => {
    const fixture = releaseFixture();
    writeFileSync(join(fixture.checkout, "chosen.txt"), "local\n");
    const refsBefore = run(fixture.checkout, ["git", "show-ref"]);
    const statusBefore = run(fixture.checkout, [
      "git",
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ]);
    const actions: string[] = [];
    const result = await rebuildDevice(fixture.paths, {
      stop: async () => actions.push("disable-stop"),
      prepare: async (_paths, _channel, revision, options) => {
        actions.push("prepare");
        expect(options).toEqual({ allowLocal: true });
        return { revision };
      },
      startAndVerify: async () => actions.push("trial-health-enable"),
    });
    expect(actions).toEqual(["disable-stop", "prepare", "trial-health-enable"]);
    expect(run(fixture.checkout, ["git", "show-ref"])).toBe(refsBefore);
    expect(
      run(fixture.checkout, [
        "git",
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
      ]),
    ).toBe(statusBefore);
    expect(result.source).toMatchObject({ dirty: true, update_safe: false });
    expect(
      JSON.parse(readFileSync(fixture.paths.installFile, "utf8")),
    ).toMatchObject({
      revision: fixture.revisionA,
      source: { kind: "chosen-source", dirty: true, update_safe: false },
    });
  });

  it("restores ordinary preview update eligibility after rebuilding reconciled clean main", async () => {
    const fixture = releaseFixture();
    run(fixture.checkout, ["git", "checkout", "main"]);
    atomicWriteJson(fixture.paths.releaseFile, {
      schema_version: 1,
      channel: "preview",
    });
    atomicWriteJson(fixture.paths.installFile, {
      schema_version: 1,
      checkout: fixture.checkout,
      channel: "preview",
      revision: fixture.revisionA,
      source: { kind: "chosen-source", dirty: true, update_safe: false },
    });
    const rebuilt = await rebuildDevice(fixture.paths, {
      stop: async () => undefined,
      prepare: async (_paths, _channel, revision) => ({ revision }),
      startAndVerify: async () => undefined,
    });
    expect(rebuilt.source).toMatchObject({
      branch: "main",
      dirty: false,
      update_safe: true,
    });
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => undefined,
        startAndVerify: async () => undefined,
      }),
    ).resolves.toMatchObject({ updated: false });
  });

  it("does not treat a clean arbitrary chosen branch as automatically update-safe", async () => {
    const fixture = releaseFixture();
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
    const rebuilt = await rebuildDevice(fixture.paths, {
      stop: async () => undefined,
      prepare: async (_paths, _channel, revision) => ({ revision }),
      startAndVerify: async () => undefined,
    });
    expect(rebuilt.source).toMatchObject({
      branch: "installed-v0.1.0",
      dirty: false,
      update_safe: false,
    });
    await expect(applyUpdate(fixture.paths)).rejects.toMatchObject({
      code: "ownership_changed",
    });
  });
});
