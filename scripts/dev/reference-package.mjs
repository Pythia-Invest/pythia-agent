import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { redactedEnvironment } from "./environment.mjs";

/*
 * The development side of reference packages (docs/architecture/reference-package.md):
 * core's own installer, run with the stack's Hermes Python, into the core
 * plugin's native data directory. Core never reads the builder's output folder.
 */

const DATA_DIRECTORY =
  "from hermes_cli.plugins import PluginState; print(PluginState('pythia').data_dir)";

function python(paths, args) {
  const executable = join(paths.hermesSource, ".venv", "bin", "python");
  if (!existsSync(executable) || !existsSync(paths.profileRoot)) {
    throw new Error(
      "This worktree's stack is not initialized; run just dev-init first.",
    );
  }
  const result = spawnSync(executable, ["-P", ...args], {
    env: { ...redactedEnvironment(), HERMES_HOME: paths.profileRoot },
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

/** The core plugin's data directory for this stack's profile, as native PluginState derives it. */
export function coreDataDirectory(paths) {
  return python(paths, ["-c", DATA_DIRECTORY]);
}

/** Run core's installer: `install <package>`, `status` or `rollback`. */
export function referencePackage(paths, command, packagePath) {
  const args = [
    join(paths.managedCore, "identity", "reference_package.py"),
    command,
    ...(packagePath ? [resolve(packagePath)] : []),
    "--data-dir",
    coreDataDirectory(paths),
  ];
  return JSON.parse(python(paths, args));
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
    const build = `${result.build_id} (as of ${result.as_of})`;
    log(
      result.changed
        ? `Reference data: installed ${build}.`
        : `Reference data: ${build} is already installed.`,
    );
    return result;
  } catch (error) {
    log(`Reference data: ${error.message}`);
    return null;
  }
}
