import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import {
  assertInstallationSource,
  rebuildDevice,
} from "../../scripts/install/runtime.mjs";
import { applyUpdate } from "../../scripts/update/apply.mjs";
import { commit, releaseFixture, run } from "../support/release-fixture";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("installation source preflight", () => {
  it("keeps stable verification strict and accepts an explicit chosen preview source", () => {
    const fixture = releaseFixture(null);
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
    const fixture = releaseFixture(null);
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
    const fixture = releaseFixture(null);
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

  it.each([
    ["branch", "installed-v0.1.0"],
    ["detached HEAD", null],
  ])(
    "rebuilds the exact chosen dirty %s without fetching or reconciling Git",
    async (_, branch) => {
      const fixture = releaseFixture(null);
      if (branch === null)
        run(fixture.checkout, ["git", "checkout", "--detach"]);
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
      expect(actions).toEqual([
        "disable-stop",
        "prepare",
        "trial-health-enable",
      ]);
      expect(run(fixture.checkout, ["git", "show-ref"])).toBe(refsBefore);
      expect(
        run(fixture.checkout, [
          "git",
          "status",
          "--porcelain=v1",
          "--untracked-files=normal",
        ]),
      ).toBe(statusBefore);
      expect(result.source).toMatchObject({
        branch,
        dirty: true,
        update_safe: false,
      });
      expect(
        JSON.parse(readFileSync(fixture.paths.installFile, "utf8")),
      ).toMatchObject({
        revision: fixture.revisionA,
        source: { kind: "chosen-source", dirty: true, update_safe: false },
      });
      // Automatic update stays strict about the chosen local source.
      await expect(applyUpdate(fixture.paths)).rejects.toMatchObject({
        code: "dirty_checkout",
      });
    },
  );

  it("restores ordinary preview update eligibility after rebuilding reconciled clean main", async () => {
    const fixture = releaseFixture(null);
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
    const fixture = releaseFixture(null);
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
