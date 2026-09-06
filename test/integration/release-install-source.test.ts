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
import { afterEach, describe, expect, it } from "vitest";
import {
  atomicWriteJson,
  copyPrivateFile,
} from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import {
  assertInstallationSource,
  rebuildDevice,
} from "../../scripts/install/runtime.mjs";
import { applyUpdate } from "../../scripts/update/apply.mjs";

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
