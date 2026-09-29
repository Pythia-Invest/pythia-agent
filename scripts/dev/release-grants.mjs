import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { RELEASE_GRANTS } from "./files.mjs";
import { MANAGED_PLUGINS, managedPluginCopies } from "./managed-plugins.mjs";

/*
 * Pythia's release trust grants (ADR 0042, amendment of 2026-09-30). Core's own
 * trust.py, run with the stack's Hermes Python, writes identity/trust.json into
 * the checkout before the payloads are copied, so core's copy and its receipt
 * carry it. Each shipped plugin with a contract is granted at the digest of
 * exactly its payload files: the digest core computes at runtime, by the same
 * function. Run it before every copy of core; the file is never committed.
 */
export function writeReleaseGrants(
  paths,
  {
    python = join(paths.hermesSource, ".venv", "bin", "python"),
    payloads = MANAGED_PLUGINS,
  } = {},
) {
  const plugins = managedPluginCopies(paths, payloads)
    .filter((plugin) => plugin.files.includes("contract.json"))
    .map(({ name, source, files }) => ({
      plugin: name,
      directory: source,
      files,
    }));
  const result = spawnSync(
    python,
    [
      "-P",
      "-B",
      join(paths.managedCore, "identity", "trust.py"),
      "release",
      "--out",
      join(paths.managedCore, RELEASE_GRANTS),
    ],
    {
      input: JSON.stringify(plugins),
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      timeout: 60_000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `Pythia's release trust grants could not be generated: ${(result.stderr || result.error?.message || `exit ${result.status}`).trim()}`,
    );
  return JSON.parse(result.stdout);
}
