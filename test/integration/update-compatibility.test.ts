import { assertTargetPrerequisites } from "../../scripts/update/target-prerequisites.mjs";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readJson, writeTransaction } from "../../scripts/install/files.mjs";
import { applyUpdate, recoverUpdate } from "../../scripts/update/apply.mjs";
import { commit, run, releaseFixture } from "../support/release-fixture.js";
describe("Update prerequisites and historical compatibility", () => {
  it("runs the real target hook from its limited snapshot with installed path identity", () => {
    const fixture = releaseFixture();
    cpSync("scripts", join(fixture.source, "scripts"), { recursive: true });
    const revision = commit(fixture.source, "real prerequisite implementation");
    mkdirSync(fixture.paths.profileRoot, { recursive: true });
    expect(() =>
      assertTargetPrerequisites(
        { ...fixture.paths, checkout: fixture.source },
        revision,
      ),
    ).toThrow("Workspace transition");
    expect(existsSync(join(fixture.paths.transactionRoot, "active.json"))).toBe(
      false,
    );
  });

  it("checks target plugin ownership for an already transitioned profile before activation", () => {
    const fixture = releaseFixture();
    cpSync("scripts", join(fixture.source, "scripts"), { recursive: true });
    cpSync(
      "runtime/managed/core",
      join(fixture.source, "runtime/managed/core"),
      { recursive: true },
    );
    const revision = commit(fixture.source, "real target plugin preflight");
    mkdirSync(fixture.paths.profileRoot, { recursive: true });
    mkdirSync(fixture.paths.stateRoot, { recursive: true });
    const paths = {
      ...fixture.paths,
      checkout: fixture.source,
      repositoryRoot: fixture.source,
    };
    writeFileSync(
      paths.runtimeReceipt,
      JSON.stringify({
        workspace_guidance: "[PYTHIA_WORKSPACE_GUIDANCE_V1]",
        stack: paths.id,
        profile: paths.profile,
        repository: paths.repositoryRoot,
        hermes_root: paths.hermesRoot,
        state_root: paths.stateRoot,
      }),
    );
    expect(() => assertTargetPrerequisites(paths, revision)).not.toThrow();
    const plugin = join(paths.profileRoot, "plugins", "pythia");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, "__init__.py"), "Investor plugin customization");
    expect(() => assertTargetPrerequisites(paths, revision)).toThrow(
      "ownership is unrecognized",
    );
    expect(readFileSync(join(plugin, "__init__.py"), "utf8")).toBe(
      "Investor plugin customization",
    );
    expect(existsSync(join(paths.transactionRoot, "active.json"))).toBe(false);
  });

  it("reproduces the shipped updater stop-before-migration failure and recovers its recorded target", async () => {
    const fixture = releaseFixture();
    const historical = join(fixture.root, "historical");
    cpSync("scripts", join(historical, "scripts"), { recursive: true });
    cpSync(
      "test/fixtures/update-562dfc9/apply-operation.mjs",
      join(historical, "scripts", "update", "apply-operation.mjs"),
    );
    mkdirSync(fixture.paths.profileRoot, { recursive: true });
    const script = `
      import { applyUpdate } from './scripts/update/apply-operation.mjs';
      import { assertWorkspaceTransitionReady } from './scripts/update/workspace-transition-state.mjs';
      const paths = JSON.parse(process.argv[1]);
      const actions = [];
      try {
        await applyUpdate(paths, {
          stop: async () => actions.push('stop'),
          completeCandidate: async () => { actions.push('prepare'); assertWorkspaceTransitionReady(paths); },
          startAndVerify: async () => actions.push('start'),
        });
      } catch (error) { console.log(JSON.stringify({ actions, error: error.message })); }
    `;
    const result = JSON.parse(
      run(historical, [
        process.execPath,
        "--input-type=module",
        "-e",
        script,
        JSON.stringify(fixture.paths),
      ]),
    );
    expect(result.actions).toEqual(["stop", "prepare", "stop"]);
    expect(result.error).toContain("Workspace transition");
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionB,
    );
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({
      phase: "failed-stopped",
      services: "stopped",
      new_revision: fixture.revisionB,
    });
    await expect(
      recoverUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: async () => undefined,
        startAndVerify: async () => undefined,
      }),
    ).resolves.toMatchObject({ recovered: true });
  });

  it("recovers a recorded older target without a prerequisite hook", async () => {
    const fixture = releaseFixture(null);
    const receipt = {
      transaction_id: "update-123-456",
      operation: "update",
      channel: "stable",
      old_revision: fixture.revisionA,
      new_revision: fixture.revisionB,
      target_version: "v0.2.0",
      current_version: "v0.1.0",
      phase: "failed-stopped",
      services: "stopped",
    };
    writeTransaction(fixture.paths, receipt);
    await expect(
      recoverUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: async () => undefined,
        startAndVerify: async () => undefined,
      }),
    ).resolves.toMatchObject({ updated: true });
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionB,
    );
  });

  it("runs the exact target prerequisite before stopping or changing the checkout", async () => {
    const fixture = releaseFixture(
      'console.error("Target needs explicit migration"); process.exitCode = 1;',
    );
    const stop = vi.fn();
    await expect(applyUpdate(fixture.paths, { stop })).rejects.toMatchObject({
      code: "target_prerequisites_pending",
    });
    expect(stop).not.toHaveBeenCalled();
    expect(run(fixture.checkout, ["git", "rev-parse", "HEAD"])).toBe(
      fixture.revisionA,
    );
    expect(existsSync(join(fixture.paths.transactionRoot, "active.json"))).toBe(
      false,
    );
    expect(run(fixture.checkout, ["git", "status", "--porcelain"])).toBe("");
  });

  it("records target preparation failures during recovery without losing the recorded target", async () => {
    const fixture = releaseFixture();
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: async () => {
          throw new Error("Initial preparation failed");
        },
      }),
    ).rejects.toThrow("Initial preparation failed");
    const start = vi.fn();
    await expect(
      recoverUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: async () => {
          throw new Error("Migration still pending");
        },
        startAndVerify: start,
      }),
    ).rejects.toThrow("Migration still pending");
    expect(start).not.toHaveBeenCalled();
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({
      phase: "failed-stopped",
      services: "stopped",
      new_revision: fixture.revisionB,
      error_message: "Migration still pending",
    });
  });
});
