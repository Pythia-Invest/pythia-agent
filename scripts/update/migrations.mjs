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
];

export function applyMigrations(paths) {
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
    migration.apply(paths);
    applied.add(migration.id);
    atomicWriteJson(ledgerPath, {
      schema_version: 1,
      applied: [...applied],
    });
  }
  return [...applied];
}
