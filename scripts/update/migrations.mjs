import { existsSync } from "node:fs";
import { atomicWriteJson, readJsonIfPresent } from "../install/files.mjs";

// Managed data plugins whose provider tools serve Desk chat only; each toolset is named after its plugin.
const PROVIDER_TOOLSETS = [
  "pythia-sec",
  "pythia-xbrl-filings",
  "pythia-gleif",
  "pythia-eodhd",
  "pythia-yahoo-discovery",
  "pythia-coinmarketcap",
  "pythia-openfigi",
  "pythia-hyperliquid",
];
// Hermes-native keys that stop agent-initiated skill writing: no background skill review, every skill_manage write
// staged for the investor's approval (`/skills pending`), and no curator rewriting skills.
const SKILL_WRITING = [
  ["skills.creation_nudge_interval", "0", 0],
  ["skills.write_approval", "true", true],
  ["curator.enabled", "false", false],
];

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
    // The agent sees core's pythia-desk tools and the plugins' provider tools on api_server (Desk chat) only;
    // every plugin operation lives in core's hidden pythia-core toolset (docs/architecture/agent-tools.md).
    // Existing profiles keep their other choices: the native command records these toolsets as known and off.
    // Agent-initiated skill writing is off through Hermes's own keys, unless the investor already chose.
    id: "0002-agent-tool-surface",
    apply(paths, { hermes }) {
      const profile = ["-p", paths.profile];
      const hidden = {
        api_server: ["pythia-core"],
        cli: ["pythia-core", "pythia-desk", ...PROVIDER_TOOLSETS],
        cron: ["pythia-core", "pythia-desk", ...PROVIDER_TOOLSETS],
      };
      // One command per platform; Hermes skips (and reports) a toolset whose plugin is not enabled.
      for (const [platform, names] of Object.entries(hidden)) {
        hermes([
          ...profile,
          "tools",
          "disable",
          ...names,
          "--platform",
          platform,
        ]);
      }
      // At the pin `config get` exits non-zero for an unset key; a value the investor set is kept.
      const read = (key) =>
        JSON.parse(
          hermes([...profile, "config", "get", key, "--json"]) || "null",
        );
      for (const [key, value, expected] of SKILL_WRITING) {
        let chosen = true;
        try {
          read(key);
        } catch {
          chosen = false;
        }
        if (chosen) continue;
        hermes([...profile, "config", "set", key, value]);
        if (read(key) !== expected) {
          throw new Error(`Hermes did not set ${key} to ${value}.`);
        }
      }
      // `tools disable` exits 0 on a toolset it does not know; require the result, not the exit code. A provider
      // toolset is known only while its plugin is enabled, so only those are checked (an opt-in plugin enabled
      // later appears on cli and cron until the investor turns it off there).
      const known = read("known_plugin_toolsets") ?? {};
      const shown = read("platform_toolsets") ?? {};
      const plugins = read("plugins.enabled");
      const enabled = new Set(Array.isArray(plugins) ? plugins : []);
      for (const [platform, names] of Object.entries(hidden)) {
        for (const name of names) {
          if (PROVIDER_TOOLSETS.includes(name) && !enabled.has(name)) continue;
          if (
            !known[platform]?.includes(name) ||
            shown[platform]?.includes(name)
          ) {
            throw new Error(
              `Hermes did not record ${name} as off for ${platform}.`,
            );
          }
        }
      }
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
