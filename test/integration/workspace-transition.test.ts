import { applyUpdate } from "../../scripts/update/apply-operation.mjs";
import {
  installDevice,
  rebuildDevice,
} from "../../scripts/install/runtime-device.mjs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
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
import { MANAGED_CORE_FILES } from "../../scripts/dev/files.mjs";

// MCP fixture is configureFreshProfile's exact pre-workspace native setter
// payload at 562dfc9. Native dotted setter/readback is independently qualified.
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-workspace-transition-"));
  roots.push(root);
  const paths = {
    id: "synthetic",
    profile: "pythia-synthetic",
    profileRoot: join(root, "profile"),
    repositoryRoot: join(root, "checkout"),
    configRoot: join(root, "config"),
    hermesRoot: join(root, "hermes"),
    hermesSource: join(root, "hermes-source"),
    workspace: join(root, "workspace"),
    knowledge: join(root, "knowledge"),
    stateRoot: join(root, "state"),
    runtimeReceipt: join(root, "state/runtime.json"),
    profileInitialization: join(root, "state/profile-initialization.json"),
    receipt: join(root, "state/foreground.json"),
    managedRoot: join(root, "managed"),
    managedCore: join(root, "managed/core"),
    managedPython: join(root, "managed/python"),
    ports: { memory: 22001, hermes: 22000, desk: 22002 },
    cacheRoot: join(root, "cache"),
    managedSkills: join(root, "managed/skills"),
    deskViewState: join(root, "state/desk-view"),
  };
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { mode: 0o600 });
  };
  write(join(paths.profileRoot, "config.yaml"), "synthetic: original config\n");
  write(
    join(paths.configRoot, "secrets.json"),
    JSON.stringify({ hermes_api_key: "synthetic-not-a-credential" }),
  );
  write(paths.runtimeReceipt, JSON.stringify({ basic_memory: "0.23.2" }));
  write(
    paths.profileInitialization,
    JSON.stringify({
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "complete",
    }),
  );
  write(
    join(paths.knowledge, "company/source.md"),
    "# Evidence\n[Details](details.md)\n[[Legacy link]]\n",
  );
  write(
    join(paths.knowledge, "company/details.md"),
    "Synthetic research, 2026-09-14.\n",
  );
  write(
    join(paths.workspace, "existing.md"),
    "Investor-owned existing research.",
  );
  write(
    join(paths.managedPython, ".venv/bin/basic-memory"),
    "synthetic preserved executable",
  );
  for (const name of MANAGED_CORE_FILES)
    write(join(paths.managedCore, name), `synthetic managed ${name}`);
  for (const [source, target] of [
    ["workspace/AGENTS.md", join(paths.workspace, "AGENTS.md")],
    ["workspace/README.md", join(paths.workspace, "README.md")],
    ["profile/SOUL.md", join(paths.profileRoot, "SOUL.md")],
  ]) {
    write(
      join(paths.repositoryRoot, "runtime/seeds", source),
      `New guidance: ${source}\n`,
    );
    write(target, `Customized old guidance: ${source}\n`);
  }
  let mcp: Record<string, unknown> | null = {
    url: "http://127.0.0.1:22001/mcp",
    enabled: true,
    timeout: 30,
    connect_timeout: 10,
    supports_parallel_tool_calls: false,
    tools: { resources: true, prompts: true },
  };
  const calls: string[][] = [];
  const nativeConfig = (_paths: unknown, args: string[]) => {
    calls.push(args);
    if (args[0] === "get") return mcp;
    expect(args).toEqual(["set", "mcp_servers.basic-memory.enabled", "false"]);
    mcp = { ...mcp, enabled: false };
    write(
      join(paths.profileRoot, "config.yaml"),
      "synthetic: native disabled owned binding\n",
    );
    return null;
  };
  const options = () => ({
    nativeConfig,
    pluginDoctor: () => undefined,
    expected: previewWorkspaceTransition(paths, { nativeConfig }).expected,
    adoptSeeds: [
      "workspace/AGENTS.md",
      "workspace/README.md",
      "profile/SOUL.md",
    ],
  });
  return {
    root,
    paths,
    write,
    calls,
    nativeConfig,
    options,
    setMcp(value: Record<string, unknown>) {
      mcp = value;
    },
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("explicit workspace storage transition", () => {
  it("does not claim a staged plugin replacement when a local plugin is preserved", () => {
    const f = fixture();
    const local = join(f.paths.profileRoot, "plugins/pythia/plugin.yaml");
    f.write(local, "name: investor-owned\n");
    expect(() => applyWorkspaceTransition(f.paths, f.options())).toThrow(
      /preserved a locally owned/,
    );
    expect(readFileSync(local, "utf8")).toBe("name: investor-owned\n");
    expect(() => assertStagedWorkspaceTransition(f.paths)).toThrow(/No staged/);
  });

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
      existsSync(join(f.paths.managedPython, ".venv/bin/basic-memory")),
    ).toBe(true);
    expect(
      applyWorkspaceTransition(f.paths, {
        nativeConfig: f.nativeConfig,
        pluginDoctor: () => undefined,
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
        afterConfig() {
          throw new Error("config interruption");
        },
      }),
    ).toThrow("config interruption");
    const staged = applyWorkspaceTransition(f.paths, {
      nativeConfig: f.nativeConfig,
      pluginDoctor: () => undefined,
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
      join(f.paths.managedPython, ".venv/bin/basic-memory"),
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
