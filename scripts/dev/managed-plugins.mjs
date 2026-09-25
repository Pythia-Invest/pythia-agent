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
]);

// Core runner helpers shared by every connector worker, validated once rather
// than repeated in each payload's `workers`.
export const MANAGED_RUNNER_SHARED = Object.freeze([
  "provider-budget.ts",
  "provider-errors.ts",
  "provider-worker.ts",
]);

/**
 * Runner inputs a payload declares, relative to `runner/`: its `workers`
 * sources and their `build:runtime` outputs (`dist/<name>.js`). Workers run in
 * place from the managed root; they are release inputs, not profile copies.
 */
export function managedWorkerFiles(plugin) {
  const sources = plugin.workers ?? [];
  return Object.freeze({
    sources,
    compiled: Object.freeze(
      sources.map((name) => `dist/${name.replace(/\.ts$/u, ".js")}`),
    ),
  });
}

/** Every payload's workers plus, once, the shared helpers they import. */
export function managedRunnerFiles(plugins) {
  const workers = plugins
    .map(managedWorkerFiles)
    .filter((files) => files.sources.length);
  return workers.length
    ? [managedWorkerFiles({ workers: MANAGED_RUNNER_SHARED }), ...workers]
    : [];
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
  const copies = payloads
    .filter((plugin) => plugin.install)
    .map((plugin) => ({
      ...plugin,
      source:
        plugin.name === "pythia"
          ? paths.managedCore
          : join(paths.managedRoot, plugin.source),
      destination: join(paths.profileRoot, "plugins", plugin.name),
    }));
  // Validate the entire input set before replacing any copied native package.
  const runnerFiles = managedRunnerFiles(copies).flatMap((files) => [
    ...files.sources,
    ...files.compiled,
  ]);
  if (runnerFiles.length)
    assertManagedPluginSource(join(paths.managedRoot, "runner"), runnerFiles);
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
