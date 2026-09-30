import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { redactedEnvironment } from "./environment.mjs";
import { ensurePrivateDirectory } from "./files.mjs";

/*
 * The development side of reference packages (docs/architecture/reference-package.md):
 * core's own installer, run with the stack's Hermes Python, into Pythia's
 * store directory (<data>/store). Core never reads the builder's output folder.
 */

// Where an earlier Pythia kept its store: the core plugin's native data directory.
const LEGACY_DIRECTORY =
  "from hermes_cli.plugins import PluginState; print(PluginState('pythia').data_dir)";

function python(paths, args) {
  const executable = join(paths.hermesSource, ".venv", "bin", "python");
  if (!existsSync(executable) || !existsSync(paths.profileRoot)) {
    throw new Error(
      "This worktree's stack is not initialized; run just dev-init first.",
    );
  }
  const result = spawnSync(executable, ["-P", ...args], {
    // The config folder holds the user's trust grants, which install records.
    env: {
      ...redactedEnvironment(),
      HERMES_HOME: paths.profileRoot,
      PYTHIA_CONFIG_ROOT: paths.configRoot,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    );
  }
  return result.stdout.trim();
}

/**
 * Run core's installer: `install <package>`, `status` or `remove`. An install first moves
 * a reference an earlier Pythia installed in the core plugin's data directory,
 * as core does on first use, so installing never leaves that copy behind.
 */
export function referencePackage(paths, command, packagePath) {
  const installer = join(paths.managedCore, "identity", "reference_package.py");
  const store = ["--data-dir", paths.store];
  let moved = null;
  if (command === "install") {
    const legacy = python(paths, ["-c", LEGACY_DIRECTORY]);
    ensurePrivateDirectory(paths.store);
    ({ moved } = JSON.parse(
      python(paths, [installer, "move", "--from", legacy, ...store]),
    ));
  }
  const args = [
    installer,
    command,
    ...(packagePath ? [resolve(packagePath)] : []),
    ...store,
  ];
  return { ...JSON.parse(python(paths, args)), ...(moved ? { moved } : {}) };
}

export function localReferencePackage(paths, environment = process.env) {
  return (
    environment.PYTHIA_DEV_REFERENCE_PACKAGE ||
    join(paths.repositoryRoot, ".local", "reference-builder", "out")
  );
}

/** Development startup: install this checkout's reference build when there is one. Never fails startup. */
export function installLocalReference(paths, options = {}) {
  const source = localReferencePackage(paths, options.environment);
  const log = options.log ?? console.log;
  if (!existsSync(join(source, "package.json"))) {
    log(
      `Reference data: no package at ${source}; build one with just reference-snapshot or run just reference-install <path>.`,
    );
    return null;
  }
  try {
    const result = referencePackage(paths, "install", source);
    if (result.moved) log(`Reference data: ${result.moved}.`);
    const build = `${result.installed.build_id} (as of ${result.installed.as_of})`;
    log(
      result.changed
        ? `Reference data: installed ${build}.`
        : `Reference data: ${build} is already installed.`,
    );
    return result;
  } catch (error) {
    // Core records the refusal; Settings -> Reference data shows it beside the package still in use.
    let kept = "No reference data is installed.";
    try {
      const { installed } = referencePackage(paths, "status");
      if (installed) kept = `Still in use: ${installed.build_id}.`;
    } catch {}
    log(`Reference data: ${error.message} ${kept}`);
    return null;
  }
}
