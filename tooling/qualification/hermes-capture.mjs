#!/usr/bin/env node
// Runs the provider-free Hermes wire capture (ADR 0020) with a pinned Hermes
// virtualenv. `--check` fails when committed goldens drift.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";

/**
 * Captures with the Hermes prepared at `hermesSource` and compares with, or
 * rewrites, the goldens in `repositoryRoot`. Returns the capture's exit code.
 */
export function runHermesCapture({ hermesSource, repositoryRoot, check }) {
  const python = join(hermesSource, ".venv", "bin", "python");
  if (!existsSync(python))
    throw new Error(
      `The pinned Hermes runtime is not prepared at ${hermesSource}; run \`just dev-init\` first.`,
    );
  const result = spawnSync(
    python,
    [
      join(repositoryRoot, "tooling/qualification/hermes-wire-capture.py"),
      "--hermes-source",
      hermesSource,
      "--repository",
      repositoryRoot,
      ...(check ? ["--check"] : []),
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const paths = resolveStackPaths();
  try {
    process.exitCode = runHermesCapture({
      hermesSource: paths.hermesSource,
      repositoryRoot: paths.repositoryRoot,
      check: process.argv.includes("--check"),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
