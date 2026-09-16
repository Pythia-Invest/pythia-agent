import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { readJsonIfPresent } from "../install/files.mjs";
import { assertLegacyBasicMemoryOwned } from "../install/systemd.mjs";
export const VERSION = 1;
const MARKER = "[PYTHIA_WORKSPACE_GUIDANCE_V1]";
export const SEEDS = [
  ["workspace/AGENTS.md", "workspace", "AGENTS.md"],
  ["workspace/README.md", "workspace", "README.md"],
  ["profile/SOUL.md", "profileRoot", "SOUL.md"],
];
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const receiptPath = (paths) =>
  join(paths.stateRoot, "workspace-transition.json");

export function regular(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected an ordinary file: ${path}`);
  return readFileSync(path);
}

export function receipt(paths) {
  const value = existsSync(receiptPath(paths))
    ? JSON.parse(regular(receiptPath(paths)))
    : null;
  if (
    value &&
    (value.version !== VERSION ||
      value.stack !== paths.id ||
      value.profileRoot !== paths.profileRoot ||
      value.workspace !== paths.workspace ||
      value.knowledge !== paths.knowledge)
  )
    throw new Error(
      "Workspace transition receipt belongs to another stack or is invalid.",
    );
  if (
    value &&
    (!["copying", "staged", "completing", "complete"].includes(value.phase) ||
      value.backupRoot !==
        join(paths.stateRoot, "workspace-transition-backup") ||
      typeof value.importRoot !== "string" ||
      dirname(value.importRoot) !== paths.workspace ||
      !/^imported-research-[1-9][0-9]*$/u.test(basename(value.importRoot)) ||
      !Array.isArray(value.files) ||
      !Array.isArray(value.seeds) ||
      value.files.some(
        (file) =>
          typeof file.path !== "string" ||
          file.path.startsWith("/") ||
          file.path
            .split("/")
            .some((part) => !part || part === "." || part === "..") ||
          !/^[a-f0-9]{64}$/u.test(file.sha256),
      ) ||
      value.seeds.some(
        (seed) =>
          !SEEDS.some(
            ([source, owner, name]) =>
              seed.source === source &&
              seed.destination === join(paths[owner], name),
          ) || !["adopt", "retain"].includes(seed.action),
      ))
  )
    throw new Error(
      "Workspace transition receipt has invalid paths or phases; preserve it for manual recovery.",
    );
  return value;
}

export function workspaceTransitionStatus(paths) {
  return receipt(paths)?.phase ?? null;
}

function completedWorkspaceInitialization(paths) {
  if (!paths.profileInitialization || !existsSync(paths.profileInitialization))
    return false;
  const value = JSON.parse(regular(paths.profileInitialization));
  return (
    value?.schema_version === 1 &&
    value.status === "complete" &&
    value.profile_initially_absent === true &&
    value.workspace_guidance === MARKER &&
    value.stack === paths.id &&
    value.profile === paths.profile &&
    value.repository === paths.repositoryRoot &&
    value.hermes_root === paths.hermesRoot &&
    value.state_root === paths.stateRoot
  );
}

/** Must precede dependency sync, plugin replacement, builds and service stops. */
export function assertWorkspaceTransitionReady(paths) {
  if (!paths.profileRoot || !existsSync(paths.profileRoot)) return;
  const current = receipt(paths);
  if (current?.phase === "complete") return;
  if (!current && completedWorkspaceInitialization(paths)) return;
  const runtime =
    paths.runtimeReceipt && readJsonIfPresent(paths.runtimeReceipt);
  if (
    !current &&
    runtime?.workspace_guidance === MARKER &&
    runtime.stack === paths.id &&
    runtime.profile === paths.profile &&
    runtime.repository === paths.repositoryRoot &&
    runtime.hermes_root === paths.hermesRoot &&
    runtime.state_root === paths.stateRoot &&
    !runtime.basic_memory
  )
    return;
  throw new Error(
    `Workspace transition ${current?.phase ?? "pending"}. Preview with ${paths.id === "production" ? "pythia" : "node scripts/dev/cli.mjs"} workspace-transition. Existing notes, dependencies and services are preserved; ordinary Workspace browsing remains available.`,
  );
}

export function nativeHermes(paths, args) {
  const result = spawnSync(
    join(paths.hermesSource, ".venv", "bin", "hermes"),
    ["-p", paths.profile, ...args],
    {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        HERMES_HOME: paths.hermesRoot,
        HERMES_DISABLE_LAZY_INSTALLS: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (
      args[0] === "config" &&
      args[1] === "get" &&
      /Config key not set:/u.test(String(result.stderr) + String(result.stdout))
    )
      return null;
    throw new Error(
      "Native Hermes configuration command failed; no direct YAML fallback is used.",
    );
  }
  return args[0] === "config" && args[1] === "get"
    ? JSON.parse(result.stdout)
    : null;
}

export function nativeConfig(paths, args) {
  return nativeHermes(paths, ["config", ...args]);
}

export function binding(paths, execute) {
  const value = execute(paths, ["get", "mcp_servers.basic-memory", "--json"]);
  if (value === null) return { status: "absent", value };
  const expected = {
    url: `http://127.0.0.1:${paths.ports.memory}/mcp`,
    enabled: true,
    timeout: 30,
    connect_timeout: 10,
    supports_parallel_tool_calls: false,
    tools: { resources: true, prompts: true },
  };
  const normalize = (entry) => JSON.stringify(entry, Object.keys(entry).sort());
  // Compare nested tool fields separately; no custom fields or endpoints are adopted.
  const { tools, ...rest } = value;
  const { tools: expectedTools, ...expectedRest } = expected;
  const owned =
    normalize({ ...rest, enabled: true }) === normalize(expectedRest) &&
    tools &&
    normalize(tools) === normalize(expectedTools) &&
    typeof value.enabled === "boolean";
  return {
    status: owned
      ? value.enabled
        ? "owned-enabled"
        : "owned-disabled"
      : "customized",
    value,
  };
}

export function inventory(root) {
  if (!existsSync(root)) return [];
  const files = [];
  function walk(relative = "") {
    const path = join(root, relative);
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Expected an ordinary directory: ${path}`);
    for (const name of readdirSync(path).sort()) {
      const child = join(relative, name);
      const entry = lstatSync(join(root, child));
      if (entry.isSymbolicLink())
        throw new Error(
          `Legacy research contains a symlink; resolve it explicitly before transition: ${child}`,
        );
      if (entry.isDirectory()) walk(child);
      else {
        const bytes = regular(join(root, child));
        files.push({
          path: child,
          sha256: digest(bytes),
          bytes: bytes.length,
          unsupportedLinks:
            /\.(?:md|markdown)$/iu.test(name) &&
            /(?:memory:\/\/|\[\[[^\]]+\]\])/u.test(bytes.toString("utf8")),
        });
      }
      if (files.length > 100_000)
        throw new Error(
          "Legacy research exceeds the bounded transition inventory; split it explicitly before retrying.",
        );
    }
  }
  walk();
  return files;
}

export function previewWorkspaceTransition(paths, options = {}) {
  const state = receipt(paths);
  if (!existsSync(paths.profileRoot)) return { status: "fresh", changes: [] };
  const ownership =
    paths.profileInitialization &&
    readJsonIfPresent(paths.profileInitialization);
  if (
    ownership?.schema_version !== 1 ||
    ownership.stack !== paths.id ||
    ownership.repository !== paths.repositoryRoot ||
    ownership.profile !== paths.profile ||
    ownership.hermes_root !== paths.hermesRoot ||
    ownership.state_root !== paths.stateRoot ||
    ownership.profile_initially_absent !== true ||
    ownership.status !== "complete"
  )
    throw new Error(
      "Completed Pythia profile initialization ownership is required; interrupted or foreign profiles are not migrated.",
    );
  const execute = options.nativeConfig ?? nativeConfig;
  const mcp = binding(paths, execute);
  const legacyService = paths.unitRoot
    ? (options.inspectLegacyService ?? assertLegacyBasicMemoryOwned)(paths)
    : null;
  const seeds = SEEDS.map(([source, owner, filename]) => {
    const destination = join(paths[owner], filename);
    const before = existsSync(destination)
      ? regular(destination).toString("utf8")
      : null;
    const after = regular(
      join(paths.repositoryRoot, "runtime", "seeds", source),
    ).toString("utf8");
    return { source, destination, before, after, changed: before !== after };
  });
  const files = inventory(paths.knowledge);
  const configHash = digest(regular(join(paths.profileRoot, "config.yaml")));
  const expected = digest(JSON.stringify({ configHash, seeds, files }));
  return {
    status: state?.phase ?? "pending",
    expected,
    binding: mcp.status,
    knowledge: paths.knowledge,
    files,
    seeds,
    legacyService,
    legacyUnit: paths.unitRoot
      ? join(paths.unitRoot, "pythia-agent-basic-memory.service")
      : null,
    instructions:
      "Apply stages verified copies without deleting originals, backs up configuration and explicitly selected seed replacements. Review each proposed before/after pair; --adopt-seed selects replacement, --retain-seed preserves reviewed user customizations (including missing seeds). Retained instructions remain authoritative, so reconcile obsolete Basic Memory directions before choosing retain. It disables only the owned Basic Memory MCP binding, and copies the current plugin. The old environment and service remain. Restart the owned Hermes service explicitly, start a new chat, then complete with that new session ID. Old chats retain cached instructions and remain readable; use Continue in a new chat to adopt current guidance. Rebuild afterward to retire dependencies. Customized MCP bindings require manual reconciliation before applying.",
  };
}
