import { fixture, roots } from "../support/workspace-transition-fixture";
import { workspaceTransitionChat } from "../../scripts/update/workspace-transition-chat.mjs";
import { applyUpdate } from "../../scripts/update/apply-operation.mjs";
import {
  installDevice,
  rebuildDevice,
} from "../../scripts/install/runtime-device.mjs";
import { existsSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceTransition,
  assertWorkspaceTransitionReady,
  assertStagedWorkspaceTransition,
  completeWorkspaceTransition,
  previewWorkspaceTransition,
  workspaceTransitionStatus,
} from "../../scripts/update/workspace-transition.mjs";
import {
  bootstrapRuntime,
  prepareManagedRuntime,
} from "../../scripts/dev/runtime-prepare.mjs";

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("explicit workspace storage transition", () => {
  it("previews concrete custom seed diffs, legacy links and binding without writes", () => {
    const f = fixture();
    const result = previewWorkspaceTransition(f.paths, {
      nativeConfig: f.nativeConfig,
      pluginDoctor: () => undefined,
    });
    expect(result.binding).toBe("owned-enabled");
    expect(
      result.seeds.every(
        (seed: { before: string; after: string }) =>
          seed.before.startsWith("Customized") && seed.after.startsWith("New"),
      ),
    ).toBe(true);
    expect(
      result.files.filter(
        (file: { unsupportedLinks: boolean }) => file.unsupportedLinks,
      ),
    ).toHaveLength(1);
    expect(
      existsSync(join(f.paths.stateRoot, "workspace-transition.json")),
    ).toBe(false);
    expect(f.calls.every((args) => args[0] === "get")).toBe(true);
  });

  it("blocks before dependency sync and requires review of every changed seed", async () => {
    const f = fixture();
    let touched = false;
    await expect(
      prepareManagedRuntime(f.paths, {
        ensureHermesSource() {
          touched = true;
        },
        runCommand() {
          touched = true;
        },
      }),
    ).rejects.toThrow("transition pending");
    expect(touched).toBe(false);
    const stop = () => {
      touched = true;
    };
    await expect(applyUpdate(f.paths, { stop })).rejects.toThrow(
      "transition pending",
    );
    await expect(installDevice(f.paths, "preview", { stop })).rejects.toThrow(
      "transition pending",
    );
    await expect(rebuildDevice(f.paths, { stop })).rejects.toThrow(
      "transition pending",
    );
    expect(touched).toBe(false);
    await expect(bootstrapRuntime(f.paths)).rejects.toThrow(
      "transition pending",
    );
    expect(() =>
      applyWorkspaceTransition(f.paths, { ...f.options(), adoptSeeds: [] }),
    ).toThrow("explicitly select");
    expect(
      existsSync(join(f.paths.stateRoot, "workspace-transition.json")),
    ).toBe(false);
    const reviewed = f.options();
    f.write(join(f.paths.workspace, "AGENTS.md"), "changed after preview");
    expect(() => applyWorkspaceTransition(f.paths, reviewed)).toThrow(
      "Preview state changed",
    );
  });

  it("preserves originals and backups, avoids import collisions, and stages restart without sync", async () => {
    const f = fixture();
    f.write(
      join(f.paths.workspace, "imported-research-1/existing.md"),
      "Do not overwrite.",
    );
    const staged = applyWorkspaceTransition(f.paths, f.options());
    expect(staged.importRoot).toBe(
      join(f.paths.workspace, "imported-research-2"),
    );
    expect(readFileSync(join(staged.importRoot, "company/source.md"))).toEqual(
      readFileSync(join(f.paths.knowledge, "company/source.md")),
    );
    expect(readFileSync(join(staged.backupRoot, "config.yaml"), "utf8")).toBe(
      "synthetic: original config\n",
    );
    expect(
      readFileSync(join(staged.backupRoot, "workspace/AGENTS.md"), "utf8"),
    ).toContain("Customized old guidance");
    expect(
      readFileSync(join(f.paths.workspace, "existing.md"), "utf8"),
    ).toContain("Investor-owned");
    expect(() => assertWorkspaceTransitionReady(f.paths)).toThrow("staged");
    const runtime = await bootstrapRuntime(f.paths, {
      allowStagedTransition: true,
    });
    expect(runtime.transition).toBe("staged");
    expect(runtime.environment.PYTHIA_WORKSPACE).toBe(f.paths.workspace);
    expect(
      readFileSync(
        join(f.paths.legacyPython, ".venv/bin/basic-memory"),
        "utf8",
      ),
    ).toBe("synthetic preserved executable");
    expect(
      applyWorkspaceTransition(f.paths, {
        nativeConfig: f.nativeConfig,
        pluginDoctor: () => undefined,
        releaseGrants: () => undefined,
      }).stagedAt,
    ).toBe(staged.stagedAt);
  });

  it("preserves customized MCP and symlinked research without attempting changes", () => {
    const f = fixture();
    f.setMcp({
      url: "http://127.0.0.1:29999/mcp",
      enabled: true,
      custom: true,
    });
    expect(() => applyWorkspaceTransition(f.paths, f.options())).toThrow(
      "Customized Basic Memory binding",
    );
    expect(f.calls.some((args) => args[0] === "set")).toBe(false);
    symlinkSync(
      join(f.paths.workspace, "existing.md"),
      join(f.paths.knowledge, "linked.md"),
    );
    expect(() =>
      previewWorkspaceTransition(f.paths, {
        nativeConfig: f.nativeConfig,
        pluginDoctor: () => undefined,
      }),
    ).toThrow("symlink");
  });

  it("stages the actual two-file shipped plugin and opens only an interactive native recovery chat", () => {
    const f = fixture();
    for (const name of ["__init__.py", "plugin.yaml"])
      f.write(
        join(f.paths.profileRoot, "plugins", "pythia", name),
        readFileSync(
          join(process.cwd(), "test/fixtures/plugin-562dfc9", name),
          "utf8",
        ),
      );
    f.write(
      join(
        f.paths.profileRoot,
        "plugins/pythia/__pycache__/__init__.cpython-312.pyc",
      ),
      "generated bytecode",
    );
    const installed = {
      ...f.paths,
      id: "production",
      unitRoot: join(f.root, "units"),
      runtimeRoot: join(f.root, "runtime"),
      dataRoot: join(f.root, "data"),
      binRoot: join(f.root, "bin"),
    };
    const ownership = JSON.parse(
      readFileSync(installed.profileInitialization, "utf8"),
    );
    f.write(
      installed.profileInitialization,
      JSON.stringify({ ...ownership, stack: installed.id }),
    );
    const options = {
      nativeConfig: f.nativeConfig,
      inspectLegacyService: () => ({ owned: true }),
    };
    const preview = previewWorkspaceTransition(installed, options);
    expect(preview.plugin.safe).toBe(true);
    let launched = false;
    expect(() =>
      workspaceTransitionChat(installed, {
        spawnSync() {
          launched = true;
        },
      }),
    ).toThrow("staged");
    expect(launched).toBe(false);
    const secrets = readFileSync(join(f.paths.configRoot, "secrets.json"));
    const staged = applyWorkspaceTransition(installed, {
      ...options,
      expected: preview.expected,
      adoptSeeds: [
        "workspace/AGENTS.md",
        "workspace/README.md",
        "profile/SOUL.md",
      ],
      pluginDoctor: () => undefined,
      releaseGrants: () => undefined,
    });
    expect(staged.phase).toBe("staged");
    expect(readFileSync(join(f.paths.configRoot, "secrets.json"))).toEqual(
      secrets,
    );
    const result = workspaceTransitionChat(installed, {
      spawnSync(
        executable: string,
        args: string[],
        launch: { cwd: string; env: Record<string, string>; stdio: string },
      ) {
        launched = true;
        expect(executable).toBe(
          join(installed.hermesSource, ".venv/bin/hermes"),
        );
        expect(args).toEqual(["-p", installed.profile, "chat"]);
        expect(launch.cwd).toBe(installed.workspace);
        expect(launch.env.HERMES_HOME).toBe(installed.hermesRoot);
        expect(launch.env.PYTHIA_WORKSPACE).toBe(installed.workspace);
        expect(launch.env.API_SERVER_KEY).toBeUndefined();
        expect(launch.stdio).toBe("inherit");
        return { status: 0 };
      },
    });
    expect(launched).toBe(true);
    expect(result.status).toBe("checkpoint-pending");
    expect(workspaceTransitionStatus(installed)).toBe("staged");
  });

  it("reports unrecognized plugin ownership before imports, seed changes or MCP disable", () => {
    const f = fixture();
    const plugin = join(f.paths.profileRoot, "plugins", "pythia");
    f.write(join(plugin, "__init__.py"), "Investor plugin customization");
    const seed = readFileSync(join(f.paths.workspace, "AGENTS.md"));
    const config = readFileSync(join(f.paths.profileRoot, "config.yaml"));
    const preview = previewWorkspaceTransition(f.paths, {
      nativeConfig: f.nativeConfig,
    });
    expect(preview.plugin.safe).toBe(false);
    expect(() => applyWorkspaceTransition(f.paths, f.options())).toThrow(
      `ownership is unrecognized at ${plugin}`,
    );
    expect(readFileSync(join(f.paths.workspace, "AGENTS.md"))).toEqual(seed);
    expect(readFileSync(join(f.paths.profileRoot, "config.yaml"))).toEqual(
      config,
    );
    expect(f.calls.some((args) => args[0] === "set")).toBe(false);
    expect(existsSync(join(f.paths.workspace, "imported-research-1"))).toBe(
      false,
    );
    expect(workspaceTransitionStatus(f.paths)).toBe(null);
  });

  it("preserves a plugin edited after interrupted research copying on retry", () => {
    const f = fixture();
    expect(() =>
      applyWorkspaceTransition(f.paths, {
        ...f.options(),
        afterCopy() {
          throw new Error("interrupted");
        },
      }),
    ).toThrow("interrupted");
    const statePath = join(f.paths.stateRoot, "workspace-transition.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    f.write(
      join(f.paths.profileRoot, "plugins/pythia/__init__.py"),
      "Custom plugin",
    );
    const seed = readFileSync(join(f.paths.workspace, "AGENTS.md"));
    expect(() =>
      applyWorkspaceTransition(f.paths, { nativeConfig: f.nativeConfig }),
    ).toThrow("ownership");
    expect(readFileSync(join(f.paths.workspace, "AGENTS.md"))).toEqual(seed);
    expect(f.calls.some((args) => args[0] === "set")).toBe(false);
    expect(JSON.parse(readFileSync(statePath, "utf8")).importRoot).toBe(
      state.importRoot,
    );
    expect(existsSync(join(f.paths.workspace, "imported-research-2"))).toBe(
      false,
    );
  });

  it("resumes interrupted copy/config without replacing research or original config backup", () => {
    const f = fixture();
    let interrupted = false;
    expect(() =>
      applyWorkspaceTransition(f.paths, {
        ...f.options(),
        afterCopy() {
          if (!interrupted) {
            interrupted = true;
            throw new Error("copy interruption");
          }
        },
      }),
    ).toThrow("copy interruption");
    expect(workspaceTransitionStatus(f.paths)).toBe("copying");
    expect(() =>
      applyWorkspaceTransition(f.paths, {
        nativeConfig: f.nativeConfig,
        pluginDoctor: () => undefined,
        releaseGrants: () => undefined,
        afterConfig() {
          throw new Error("config interruption");
        },
      }),
    ).toThrow("config interruption");
    const staged = applyWorkspaceTransition(f.paths, {
      nativeConfig: f.nativeConfig,
      pluginDoctor: () => undefined,
      releaseGrants: () => undefined,
    });
    expect(staged.phase).toBe("staged");
    expect(readFileSync(join(staged.backupRoot, "config.yaml"), "utf8")).toBe(
      "synthetic: original config\n",
    );
    expect(f.calls.filter((args) => args[0] === "set")).toHaveLength(1);
  });

  it("requires a post-stage native session, readback and stopped development owner before completion", () => {
    const f = fixture();
    const staged = applyWorkspaceTransition(f.paths, f.options());
    let threshold: number | undefined;
    expect(() =>
      completeWorkspaceTransition(f.paths, {
        nativeConfig: f.nativeConfig,
        pluginDoctor: () => undefined,
        sessionId: "old",
        verifyGuidance(_paths: unknown, _id: string, after: number) {
          threshold = after;
          return false;
        },
      }),
    ).toThrow("fresh native chat");
    expect(threshold).toBe(staged.stagedAt);
    f.write(f.paths.receipt, "synthetic active owner");
    expect(() =>
      completeWorkspaceTransition(f.paths, {
        nativeConfig: f.nativeConfig,
        pluginDoctor: () => undefined,
        sessionId: "fresh",
        verifyGuidance: () => true,
      }),
    ).toThrow("Stop the owned development stack");
    rmSync(f.paths.receipt);
    const complete = completeWorkspaceTransition(f.paths, {
      nativeConfig: f.nativeConfig,
      pluginDoctor: () => undefined,
      sessionId: "fresh",
      verifyGuidance: () => true,
    });
    expect(complete.phase).toBe("complete");
    expect(() => assertWorkspaceTransitionReady(f.paths)).not.toThrow();
    expect(completeWorkspaceTransition(f.paths).completedAt).toBe(
      complete.completedAt,
    );
  });

  it("resumes an interrupted owned service retirement with verified state intact", () => {
    const f = fixture();
    const installed = { ...f.paths, unitRoot: join(f.root, "units") };
    const staged = applyWorkspaceTransition(installed, {
      ...f.options(),
      inspectLegacyService: () => ({ owned: true }),
    });
    let calls = 0;
    const options = {
      nativeConfig: f.nativeConfig,
      sessionId: "fresh",
      verifyGuidance: () => true,
      retireLegacyService() {
        calls += 1;
        if (calls === 1) throw new Error("retirement interrupted");
      },
    };
    expect(() => completeWorkspaceTransition(installed, options)).toThrow(
      "retirement interrupted",
    );
    expect(workspaceTransitionStatus(installed)).toBe("completing");
    expect(() => assertWorkspaceTransitionReady(installed)).toThrow(
      "completing",
    );
    expect(completeWorkspaceTransition(installed, options).phase).toBe(
      "complete",
    );
    expect(calls).toBe(2);
    expect(readFileSync(join(staged.importRoot, "company/source.md"))).toEqual(
      readFileSync(join(f.paths.knowledge, "company/source.md")),
    );
  });

  it("retains explicitly reviewed custom guidance without replacing user preferences", () => {
    const f = fixture();
    const before = readFileSync(join(f.paths.workspace, "AGENTS.md"));
    const options = f.options();
    const staged = applyWorkspaceTransition(f.paths, {
      ...options,
      adoptSeeds: ["workspace/README.md", "profile/SOUL.md"],
      retainSeeds: ["workspace/AGENTS.md"],
    });
    expect(
      staged.seeds.find(
        (seed: { source: string }) => seed.source === "workspace/AGENTS.md",
      ).action,
    ).toBe("retain");
    expect(readFileSync(join(f.paths.workspace, "AGENTS.md"))).toEqual(before);
    const complete = completeWorkspaceTransition(f.paths, {
      nativeConfig: f.nativeConfig,
      pluginDoctor: () => undefined,
      sessionId: "fresh",
      verifyGuidance: () => true,
    });
    expect(complete.phase).toBe("complete");
    expect(readFileSync(join(f.paths.workspace, "AGENTS.md"))).toEqual(before);
  });

  it("refuses changed preserved executable or imported bytes", () => {
    const f = fixture();
    const staged = applyWorkspaceTransition(f.paths, f.options());
    f.write(
      join(f.paths.legacyPython, ".venv/bin/basic-memory"),
      "different executable",
    );
    expect(() => assertStagedWorkspaceTransition(f.paths)).toThrow(
      "preserved Basic Memory executable changed",
    );
    f.write(
      join(staged.importRoot, "company/source.md"),
      "changed imported evidence",
    );
    expect(() =>
      completeWorkspaceTransition(f.paths, {
        nativeConfig: f.nativeConfig,
        pluginDoctor: () => undefined,
        verifyGuidance: () => true,
      }),
    ).toThrow("Imported research changed");
  });

  it("refuses foreign transition receipts and allows a fresh current profile without migration", () => {
    const f = fixture();
    const staged = applyWorkspaceTransition(f.paths, f.options());
    f.write(
      join(f.paths.stateRoot, "workspace-transition.json"),
      JSON.stringify({ ...staged, stack: "foreign" }),
    );
    expect(() => assertWorkspaceTransitionReady(f.paths)).toThrow(
      "another stack",
    );
    rmSync(join(f.paths.stateRoot, "workspace-transition.json"));
    f.write(
      f.paths.runtimeReceipt,
      JSON.stringify({
        workspace_guidance: "[PYTHIA_WORKSPACE_GUIDANCE_V1]",
        stack: f.paths.id,
        profile: f.paths.profile,
        repository: f.paths.repositoryRoot,
        hermes_root: f.paths.hermesRoot,
        state_root: f.paths.stateRoot,
      }),
    );
    expect(() => assertWorkspaceTransitionReady(f.paths)).not.toThrow();
  });
});
