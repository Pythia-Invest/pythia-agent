import { join } from "node:path";
import {
  assertManagedPluginSource,
  MANAGED_CORE_FILES,
  refreshManagedPlugin,
} from "./files.mjs";
import { hermesRun } from "./runtime-config.mjs";

// Release payloads, not an enabled-plugin inventory. Native Hermes owns discovery
// and all plugin/platform choices. Keep every installed helper explicit here.
export const MANAGED_PLUGINS = Object.freeze([
  Object.freeze({
    name: "pythia",
    install: true,
    enabledByDefault: true,
    doctor: true,
    source: "core",
    files: MANAGED_CORE_FILES,
  }),
  Object.freeze({
    name: "pythia-market-data",
    install: true,
    enabledByDefault: true,
    // Native doctor isolates one plugin, so it cannot validate dependencies.
    // The copied core + feature have an assembled native qualification instead.
    doctor: false,
    source: "plugins/market-data",
    files: Object.freeze([
      "__init__.py",
      "_platform.py",
      "presentation.py",
      "transport.py",
      "plugin.yaml",
      "backend.py",
      "cache.py",
      "coordinated.py",
      "delivery.py",
      "live_batch.py",
      "governor.py",
      "worker_budget.py",
      "worker_reads.py",
      "connector.py",
      "diagnostics.py",
      "failures.py",
      "resident_worker.py",
      "native_batch.py",
      "subscriptions.py",
      "process_stream.py",
      "request_context.py",
      "contributions.py",
      "credentials.py",
      "public_http.py",
      "definition.py",
      "execution.py",
      "identity.py",
      "identity_db.py",
      "identity_matching.py",
      "identity_overrides.py",
      "identity_repair.py",
      "preferences.py",
      "process.py",
      "reads.py",
      "selection.py",
      "specialist.py",
      "wire.py",
      "wire_schema.py",
      "skills/market-data/SKILL.md",
      "widgets/instrument-tile.tsx",
      "widgets/instrument-compact-tile.tsx",
      "widgets/instrument-table.tsx",
      "widgets/instruments.tsx",
      "dist/widgets/instruments.mjs",
    ]),
  }),
  Object.freeze({
    name: "pythia-yahoo-discovery",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/yahoo-discovery",
    files: Object.freeze([
      "__init__.py",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "identity.py",
      "series.py",
      "results.py",
    ]),
    workers: Object.freeze(["yahoo.ts", "yahoo-prices.ts", "yahoo-options.ts"]),
  }),
  Object.freeze({
    name: "pythia-sec",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/sec",
    files: Object.freeze([
      "__init__.py",
      "plugin.yaml",
      "configuration.json",
      "README.md",
      "definition.py",
      "client.py",
      "identity.py",
      "financials.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-openfigi",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/openfigi",
    files: Object.freeze([
      "__init__.py",
      "plugin.yaml",
      "configuration.json",
      "README.md",
      "definition.py",
      "client.py",
      "mapping.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-gleif",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/gleif",
    files: Object.freeze([
      "__init__.py",
      "definition.py",
      "records.py",
      "profile.py",
      "plugin.yaml",
      "README.md",
      "skills/gleif/SKILL.md",
    ]),
  }),
  Object.freeze({
    name: "pythia-xbrl-filings",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/xbrl-filings",
    files: Object.freeze([
      "__init__.py",
      "definition.py",
      "identity.py",
      "reports.py",
      "facts.py",
      "plugin.yaml",
      "README.md",
      "skills/xbrl-filings/SKILL.md",
    ]),
  }),
  Object.freeze({
    name: "pythia-coingecko",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/coingecko",
    files: Object.freeze([
      "__init__.py",
      "plugin.yaml",
      "configuration.json",
      "README.md",
      "config.py",
      "definition.py",
      "identity.py",
      "catalogue.py",
      "series.py",
      "results.py",
      "dashboard.py",
    ]),
    workers: Object.freeze(["coingecko/main.py"]),
  }),
  Object.freeze({
    name: "pythia-coinmarketcap",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/coinmarketcap",
    // The isolated Python worker is copied with the package; no runner workers.
    files: Object.freeze([
      "__init__.py",
      "plugin.yaml",
      "configuration.json",
      "README.md",
      "catalogue.py",
      "config.py",
      "definition.py",
      "identity.py",
      "profile.py",
      "series.py",
      "worker.py",
    ]),
  }),
]);

// Core runner helpers that connector workers import. Listed once, ahead of the
// first payload's workers, rather than repeated in each payload's `workers`.
export const MANAGED_RUNNER_SHARED = Object.freeze([
  "provider-budget.ts",
  "provider-errors.ts",
  "provider-worker.ts",
]);

const MANAGED = "runtime/managed/";
const RUNNER = `${MANAGED}runner`;

/**
 * Runner build inputs of these payloads, shaped like MANAGED_WIDGET_BUILDS.
 * `workers` name files under `runner/`. A TypeScript worker compiles through
 * `build:runtime` to `dist/<name>.js`; any other worker (for example a Python
 * `coingecko/main.py`) runs as source and has no output. Workers run in place
 * from the managed root and are never profile copies: never list them in
 * `files`.
 */
export function managedRunnerBuilds(plugins) {
  const workers = plugins.flatMap((plugin) => plugin.workers ?? []);
  if (!workers.length) return [];
  return [...MANAGED_RUNNER_SHARED, ...workers].map((name) =>
    Object.freeze({
      entry: `${RUNNER}/${name}`,
      output: name.endsWith(".ts")
        ? `${RUNNER}/dist/${name.slice(0, -".ts".length)}.js`
        : null,
    }),
  );
}

/** Installed payloads with their managed source and profile destination. */
export function managedPluginCopies(paths, payloads = MANAGED_PLUGINS) {
  return payloads
    .filter((plugin) => plugin.install)
    .map((plugin) => ({
      ...plugin,
      source:
        plugin.name === "pythia"
          ? paths.managedCore
          : join(paths.managedRoot, plugin.source),
      destination: join(paths.profileRoot, "plugins", plugin.name),
    }));
}

export function refreshManagedPlugins(
  paths,
  apiKey,
  {
    freshProfile = false,
    execute = hermesRun,
    payloads = MANAGED_PLUGINS,
    report = console.warn,
  } = {},
) {
  const copies = managedPluginCopies(paths, payloads);
  // Validate the entire input set before replacing any copied native package.
  const runner = managedRunnerBuilds(copies).flatMap(({ entry, output }) =>
    [entry, output].flatMap((path) =>
      path ? [path.slice(MANAGED.length)] : [],
    ),
  );
  if (runner.length) assertManagedPluginSource(paths.managedRoot, runner);
  for (const plugin of copies)
    assertManagedPluginSource(plugin.source, plugin.files);
  const results = [];
  for (const plugin of copies) {
    const result = refreshManagedPlugin(
      plugin.source,
      plugin.destination,
      plugin.files,
    );
    results.push({ ...plugin, ...result });
    if (result.status === "preserved")
      report(
        `Preserved local plugin ${plugin.name}; managed update skipped: ${result.reason}. ${plugin.destination}`,
      );
  }
  const managed = results.filter((plugin) => plugin.status !== "preserved");
  for (const plugin of managed.filter((plugin) => plugin.doctor)) {
    execute(
      paths,
      ["-p", paths.profile, "plugins", "doctor", plugin.destination, "--ci"],
      apiKey,
    );
  }
  if (freshProfile) {
    for (const plugin of managed.filter((plugin) => plugin.enabledByDefault)) {
      execute(
        paths,
        [
          "-p",
          paths.profile,
          "plugins",
          "enable",
          plugin.name,
          "--no-allow-tool-override",
        ],
        apiKey,
      );
    }
  }
  return results.map(({ name, destination, status, reason }) => ({
    name,
    destination,
    status,
    reason,
  }));
}
