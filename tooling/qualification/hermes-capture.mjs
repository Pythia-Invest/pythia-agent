#!/usr/bin/env node
// Runs the provider-free Hermes wire capture (ADR 0020) with this worktree's
// pinned Hermes virtualenv. `--check` fails when committed goldens drift.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";

const paths = resolveStackPaths();
const python = join(paths.hermesSource, ".venv", "bin", "python");
if (!existsSync(python)) {
  console.error(
    `The pinned Hermes runtime is not prepared at ${paths.hermesSource}; run \`just dev-init\` first.`,
  );
  process.exit(1);
}
const result = spawnSync(
  python,
  [
    join(paths.repositoryRoot, "tooling/qualification/hermes-wire-capture.py"),
    "--hermes-source",
    paths.hermesSource,
    "--repository",
    paths.repositoryRoot,
    ...process.argv.slice(2).filter((arg) => arg === "--check"),
  ],
  { cwd: paths.repositoryRoot, stdio: "inherit" },
);
process.exit(result.status ?? 1);
