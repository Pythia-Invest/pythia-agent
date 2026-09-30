import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { expect } from "vitest";
import { MANAGED_CORE_FILES } from "../../scripts/dev/files.mjs";
import { previewWorkspaceTransition } from "../../scripts/update/workspace-transition.mjs";

// MCP fixture is configureFreshProfile's exact pre-workspace native setter
// payload at 562dfc9. Native dotted setter/readback is independently qualified.
// previewWorkspaceTransition returns only `{ status: "fresh", changes }` when
// the profile does not exist yet; every fixture creates one.
export type ProfilePreview = Extract<
  ReturnType<typeof previewWorkspaceTransition>,
  { seeds: unknown }
>;
export const roots: string[] = [];
export function fixture() {
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
    legacyPython: join(root, "managed/python"),
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
    join(paths.legacyPython, ".venv/bin/basic-memory"),
    "synthetic preserved executable",
  );
  for (const name of MANAGED_CORE_FILES)
    write(join(paths.managedCore, name), `synthetic managed ${name}`);
  const seedTargets: [string, string][] = [
    ["workspace/AGENTS.md", join(paths.workspace, "AGENTS.md")],
    ["workspace/README.md", join(paths.workspace, "README.md")],
    ["profile/SOUL.md", join(paths.profileRoot, "SOUL.md")],
  ];
  for (const [source, target] of seedTargets) {
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
