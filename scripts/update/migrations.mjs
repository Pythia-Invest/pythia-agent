import { existsSync } from "node:fs";
import { atomicWriteJson, readJsonIfPresent } from "../install/files.mjs";

const MIGRATIONS = [
  {
    id: "0001-device-state-v1",
    apply(paths) {
      for (const path of [paths.configRoot, paths.stateRoot, paths.dataRoot]) {
        if (!existsSync(path)) {
          throw new Error(`Required Pythia state root is missing: ${path}`);
        }
      }
    },
  },
  {
    // The agent sees core's pythia-desk tools; every plugin operation lives in core's hidden pythia-core
    // toolset (docs/architecture/agent-tools.md). Existing profiles keep their other choices: the native
    // command records pythia-core, and pythia-desk outside Desk chat, as known and off.
    id: "0002-agent-tool-surface",
    apply(paths, { hermes }) {
      const profile = ["-p", paths.profile];
      for (const platform of ["api_server", "cli", "cron"]) {
        hermes([
          ...profile,
          "tools",
          "disable",
          "pythia-core",
          "--platform",
          platform,
        ]);
      }
      for (const platform of ["cli", "cron"]) {
        hermes([
          ...profile,
          "tools",
          "disable",
          "pythia-desk",
          "--platform",
          platform,
        ]);
      }
      hermes([...profile, "config", "set", "tools.tool_search.enabled", "off"]);
    },
  },
];

/** `hermes(args)` runs one native Hermes command for this installation. */
export function applyMigrations(paths, { hermes } = {}) {
  const ledgerPath = `${paths.stateRoot}/migrations.json`;
  const ledger = readJsonIfPresent(ledgerPath) ?? {
    schema_version: 1,
    applied: [],
  };
  if (
    ledger.schema_version !== 1 ||
    !Array.isArray(ledger.applied) ||
    ledger.applied.some((value) => typeof value !== "string")
  ) {
    throw new Error(`Migration ledger is invalid: ${ledgerPath}`);
  }
  const applied = new Set(ledger.applied);
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    migration.apply(paths, {
      hermes:
        hermes ??
        (() => {
          throw new Error(
            `Migration ${migration.id} needs the native Hermes command`,
          );
        }),
    });
    applied.add(migration.id);
    atomicWriteJson(ledgerPath, {
      schema_version: 1,
      applied: [...applied],
    });
  }
  return [...applied];
}
