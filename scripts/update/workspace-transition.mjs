import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import {
  atomicWrite,
  atomicWriteJson,
  ensurePrivateDirectory,
} from "../install/files.mjs";
import { MANAGED_CORE_FILES, refreshManagedPlugin } from "../dev/files.mjs";
import {
  VERSION,
  SEEDS,
  digest,
  receiptPath,
  regular,
  receipt,
  nativeConfig,
  nativeHermes,
  binding,
  inventory,
  previewWorkspaceTransition,
} from "./workspace-transition-state.mjs";
export {
  assertWorkspaceTransitionReady,
  workspaceTransitionStatus,
  previewWorkspaceTransition,
} from "./workspace-transition-state.mjs";
function save(paths, state) {
  atomicWriteJson(receiptPath(paths), state);
}
function verifyCopies(paths, state) {
  if (
    JSON.stringify(inventory(paths.knowledge)) !== JSON.stringify(state.files)
  )
    throw new Error(
      "Original legacy research changed since staging; preserve the staged import and reconcile before retrying.",
    );
  for (const file of state.files) {
    if (digest(regular(join(state.importRoot, file.path))) !== file.sha256)
      throw new Error(
        `Imported research changed or is incomplete: ${file.path}`,
      );
  }
}

/** Explicit operation only; callers hold the existing lifecycle/preparation lock. */
export function applyWorkspaceTransition(paths, options = {}) {
  const execute = options.nativeConfig ?? nativeConfig;
  let state = receipt(paths);
  if (state?.phase === "complete") return state;
  const preview = previewWorkspaceTransition(paths, {
    nativeConfig: execute,
    inspectLegacyService: options.inspectLegacyService,
  });
  if (preview.status === "fresh")
    throw new Error("No existing profile requires a transition.");
  if (preview.binding === "customized")
    throw new Error(
      "Customized Basic Memory binding is preserved. Reconcile it using native Hermes configuration, then preview again.",
    );
  if (!state) {
    regular(join(paths.legacyPython, ".venv", "bin", "basic-memory"));
    if (!options.expected || options.expected !== preview.expected)
      throw new Error(
        "Preview state changed or --expect is missing; preview the concrete changes again.",
      );
    const selected = options.adoptSeeds ?? [];
    const retained = options.retainSeeds ?? [];
    if (selected.some((name) => retained.includes(name)))
      throw new Error("Choose adopt or retain for each seed, not both.");
    if (
      [...selected, ...retained].some(
        (source) => !SEEDS.some(([name]) => source === name),
      )
    )
      throw new Error("Unknown selected seed.");
    const unreviewed = preview.seeds.filter(
      (seed) =>
        seed.changed &&
        !selected.includes(seed.source) &&
        !retained.includes(seed.source),
    );
    if (unreviewed.length)
      throw new Error(
        `Review and explicitly select --adopt-seed to replace or --retain-seed to preserve each custom or manually reconciled seed: ${unreviewed.map((seed) => seed.source).join(", ")}`,
      );
    ensurePrivateDirectory(paths.stateRoot);
    ensurePrivateDirectory(paths.workspace);
    const backupRoot = join(paths.stateRoot, "workspace-transition-backup");
    if (existsSync(backupRoot))
      throw new Error(
        "Unreceipted transition backup exists; inspect it before retrying.",
      );
    let number = 1;
    let importRoot;
    do {
      importRoot = join(paths.workspace, `imported-research-${number++}`);
    } while (existsSync(importRoot));
    state = {
      version: VERSION,
      stack: paths.id,
      profileRoot: paths.profileRoot,
      workspace: paths.workspace,
      knowledge: paths.knowledge,
      phase: "copying",
      backupRoot,
      importRoot,
      files: preview.files,
      seeds: preview.seeds
        .filter((seed) => seed.changed)
        .map((seed) => ({
          source: seed.source,
          destination: seed.destination,
          beforeHash: seed.before === null ? null : digest(seed.before),
          action: retained.includes(seed.source) ? "retain" : "adopt",
          afterHash: retained.includes(seed.source)
            ? seed.before === null
              ? null
              : digest(seed.before)
            : digest(seed.after),
        })),
      configHash: digest(regular(join(paths.profileRoot, "config.yaml"))),
      startedAt: Date.now() / 1000,
    };
    save(paths, state);
  }
  if (["staged", "completing"].includes(state.phase)) return state;
  if (state.phase !== "copying")
    throw new Error("Unknown transition phase; preserve receipt for recovery.");
  ensurePrivateDirectory(state.backupRoot);
  ensurePrivateDirectory(state.importRoot);
  const backupConfig = join(state.backupRoot, "config.yaml");
  if (!existsSync(backupConfig)) {
    const original = regular(join(paths.profileRoot, "config.yaml"));
    if (digest(original) !== state.configHash)
      throw new Error(
        "Configuration changed before its backup; preview again after manual reconciliation.",
      );
    copyFileSync(
      join(paths.profileRoot, "config.yaml"),
      backupConfig,
      constants.COPYFILE_EXCL,
    );
  }
  if (
    JSON.stringify(inventory(paths.knowledge)) !== JSON.stringify(state.files)
  )
    throw new Error(
      "Original research changed before copying; preserve receipt and reconcile.",
    );
  for (const file of state.files) {
    const target = join(state.importRoot, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (!existsSync(target))
      copyFileSync(
        join(paths.knowledge, file.path),
        target,
        constants.COPYFILE_EXCL,
      );
    if (digest(regular(target)) !== file.sha256)
      throw new Error(`Import collision or incomplete copy: ${file.path}`);
    options.afterCopy?.(file);
  }
  verifyCopies(paths, state);
  for (const seed of state.seeds) {
    if (seed.action === "retain") {
      const currentHash = existsSync(seed.destination)
        ? digest(regular(seed.destination))
        : null;
      if (currentHash !== seed.afterHash)
        throw new Error(`Retained seed changed after review: ${seed.source}`);
      continue;
    }
    const after = regular(
      join(paths.repositoryRoot, "runtime", "seeds", seed.source),
    );
    if (digest(after) !== seed.afterHash)
      throw new Error(
        "Selected seed source changed; preserve transition and review the new source.",
      );
    const before = existsSync(seed.destination)
      ? regular(seed.destination)
      : null;
    if (before && digest(before) === seed.afterHash) continue;
    if ((before ? digest(before) : null) !== seed.beforeHash)
      throw new Error(`Selected seed changed after review: ${seed.source}`);
    if (before) {
      const backup = join(state.backupRoot, seed.source);
      ensurePrivateDirectory(dirname(backup));
      if (!existsSync(backup))
        copyFileSync(seed.destination, backup, constants.COPYFILE_EXCL);
    }
    atomicWrite(seed.destination, after);
  }
  const currentBinding = binding(paths, execute);
  if (currentBinding.status === "customized")
    throw new Error("Native MCP binding changed; preserved without disabling.");
  if (currentBinding.status === "owned-enabled")
    execute(paths, ["set", "mcp_servers.basic-memory.enabled", "false"]);
  if (!["owned-disabled", "absent"].includes(binding(paths, execute).status))
    throw new Error("Native MCP disable readback failed.");
  options.afterConfig?.();
  const pluginCopy = refreshManagedPlugin(
    paths.managedCore,
    join(paths.profileRoot, "plugins", "pythia"),
  );
  if (pluginCopy.status === "preserved")
    throw new Error(
      "Workspace transition preserved a locally owned Pythia plugin. Reconcile that replacement before staging the managed transition.",
    );
  (
    options.pluginDoctor ??
    ((currentPaths) =>
      nativeHermes(currentPaths, [
        "plugins",
        "doctor",
        join(currentPaths.profileRoot, "plugins", "pythia"),
        "--ci",
      ]))
  )(paths);
  state.pluginFiles = MANAGED_CORE_FILES.map((name) => ({
    name,
    sha256: digest(regular(join(paths.managedCore, name))),
  }));
  const legacyExecutable = join(
    paths.legacyPython,
    ".venv",
    "bin",
    "basic-memory",
  );
  state.legacyExecutable = {
    path: legacyExecutable,
    sha256: digest(regular(legacyExecutable)),
  };
  state.phase = "staged";
  state.stagedAt = Date.now() / 1000;
  save(paths, state);
  return state;
}

export function assertStagedWorkspaceTransition(paths) {
  const state = receipt(paths);
  if (state?.phase !== "staged")
    throw new Error("No staged workspace transition is available.");
  const executable = join(paths.legacyPython, ".venv", "bin", "basic-memory");
  if (
    state.legacyExecutable?.path !== executable ||
    digest(regular(executable)) !== state.legacyExecutable.sha256
  )
    throw new Error(
      "The preserved Basic Memory executable changed; staged startup cannot replace or repair its environment.",
    );
  verifyCopies(paths, state);
  for (const file of state.pluginFiles)
    if (
      digest(
        regular(join(paths.profileRoot, "plugins", "pythia", file.name)),
      ) !== file.sha256
    )
      throw new Error(
        "The staged plugin changed; preserve the old environment and review before startup.",
      );
  return state;
}

function guidance(paths, sessionId, createdAfter) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(sessionId ?? ""))
    throw new Error("An exact fresh native session ID is required.");
  const result = spawnSync(
    join(paths.hermesSource, ".venv", "bin", "python"),
    [
      "-B",
      join(paths.managedRoot, "runner", "native_session_context.py"),
      "--db",
      join(paths.profileRoot, "state.db"),
      "--created-after",
      String(createdAfter),
    ],
    {
      input: JSON.stringify({ sessionId }),
      encoding: "utf8",
      timeout: 4000,
      maxBuffer: 8192,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        HERMES_HOME: paths.hermesRoot,
        HERMES_DISABLE_LAZY_INSTALLS: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONIOENCODING: "utf-8",
      },
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      "Native fresh-session guidance verification is unavailable.",
    );
  const value = JSON.parse(result.stdout);
  return value.status === "ok" && value.guidance === "current";
}

export function completeWorkspaceTransition(paths, options = {}) {
  const state = receipt(paths);
  if (state?.phase === "complete") return state;
  if (!["staged", "completing"].includes(state?.phase))
    throw new Error("Stage the reviewed transition first.");
  verifyCopies(paths, state);
  for (const seed of state.seeds)
    if (
      (existsSync(seed.destination)
        ? digest(regular(seed.destination))
        : null) !== seed.afterHash
    )
      throw new Error(
        "Selected seed changed after staging; review before completing.",
      );
  for (const file of state.pluginFiles)
    if (
      digest(
        regular(join(paths.profileRoot, "plugins", "pythia", file.name)),
      ) !== file.sha256
    )
      throw new Error("Copied plugin changed after staging.");
  if (
    !["owned-disabled", "absent"].includes(
      binding(paths, options.nativeConfig ?? nativeConfig).status,
    )
  )
    throw new Error(
      "Native Basic Memory binding is not retired; configuration remains user-owned.",
    );
  if (
    !(options.verifyGuidance ?? guidance)(
      paths,
      options.sessionId,
      state.stagedAt,
    )
  )
    throw new Error(
      "Start a fresh native chat after staging; its stored prompt must contain current Workspace guidance before retiring the old service.",
    );
  state.phase = "completing";
  save(paths, state);
  if (paths.unitRoot) {
    if (!options.retireLegacyService)
      throw new Error("Owned installed service retirement is required.");
    options.retireLegacyService(paths);
  } else if (existsSync(paths.receipt))
    throw new Error(
      "Stop the owned development stack before completing the transition.",
    );
  state.phase = "complete";
  state.completedAt = Date.now() / 1000;
  state.verifiedSessionId = options.sessionId;
  save(paths, state);
  return state;
}
