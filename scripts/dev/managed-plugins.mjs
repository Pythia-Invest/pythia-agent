// pythia-structure-ignore: the release payload list keeps one explicit entry per shipped plugin beside the helpers that install them; splitting it would scatter the allowlist.
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
      "presentation.py",
      "transport.py",
      "plugin.yaml",
      "backend.py",
      "coordinated.py",
      "delivery.py",
      "live_batch.py",
      "subscriptions.py",
      "contributions.py",
      "definition.py",
      "execution.py",
      "reads.py",
      "selection.py",
      "skills/market-data/SKILL.md",
      "widgets/instrument-tile.tsx",
      "widgets/instrument-compact-tile.tsx",
      "widgets/instrument-table.tsx",
      "widgets/instruments.tsx",
      "widgets/instrument-chart.tsx",
      "widgets/top-bar.tsx",
      "dist/widgets/instruments.mjs",
      "dist/widgets/instrument-chart.mjs",
      "dist/widgets/top-bar.mjs",
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
      "contract.json",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "identity.py",
      "series.py",
      "results.py",
      "movers.py",
    ]),
    workers: Object.freeze([
      "yahoo.ts",
      "yahoo-prices.ts",
      "yahoo-sessions.ts",
      "yahoo-options.ts",
      "yahoo-news.ts",
    ]),
  }),
  Object.freeze({
    name: "pythia-sec",
    install: true,
    enabledByDefault: true,
    doctor: false,
    source: "plugins/sec",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "configuration.json",
      "README.md",
      "definition.py",
      "client.py",
      "identity.py",
      "financials.py",
      "filings.py",
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
      "contract.json",
      "plugin.yaml",
      "configuration.json",
      "README.md",
      "definition.py",
      "client.py",
      "mapping.py",
      "vocabulary.json",
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
      "contract.json",
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
      "contract.json",
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
    name: "pythia-nsm",
    install: true,
    // Opt-in by product default: it reads an undocumented FCA endpoint.
    enabledByDefault: false,
    doctor: false,
    source: "plugins/nsm",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "definition.py",
      "records.py",
      "plugin.yaml",
      "README.md",
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
      "contract.json",
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
      "contract.json",
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
  Object.freeze({
    name: "pythia-hyperliquid",
    install: true,
    // Opt-in: enabling it is the investor's choice to open a socket to
    // Hyperliquid under its terms. Keyless; no worker process.
    enabledByDefault: false,
    doctor: false,
    source: "plugins/hyperliquid",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "feed.py",
      "market.py",
      "stream.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-defillama",
    install: true,
    // Opt-in by product default: DefiLlama's terms allow personal,
    // non-commercial use only. Keyless; no worker process.
    enabledByDefault: false,
    doctor: false,
    source: "plugins/defillama",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "catalogue.py",
      "metrics.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-navi",
    install: true,
    // Opt-in by product default: NAVI publishes no data terms, so its
    // open API is used as a personal, local source. Keyless; no worker process.
    enabledByDefault: false,
    doctor: false,
    source: "plugins/navi",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "catalogue.py",
      "metrics.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-cetus",
    install: true,
    // Opt-in by product default: Cetus publishes no data terms for its stats API, so it is
    // used as a personal, local source. Keyless; no worker process.
    enabledByDefault: false,
    doctor: false,
    source: "plugins/cetus",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "catalogue.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-suilend",
    install: true,
    // Opt-in by product default: Suilend publishes no data terms for its API, so it is
    // used as a personal, local source. Keyless; no worker process.
    enabledByDefault: false,
    doctor: false,
    source: "plugins/suilend",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "catalogue.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-deepbook",
    install: true,
    // Opt-in by product default: Mysten Labs states no terms or limits for the DeepBook indexer, so it is
    // used as a personal, local source. Keyless; no worker process.
    enabledByDefault: false,
    doctor: false,
    source: "plugins/deepbook",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "README.md",
      "definition.py",
      "catalogue.py",
    ]),
  }),
  Object.freeze({
    name: "pythia-eodhd",
    install: true,
    // Makes no provider request until its declared configuration
    // (configuration.json) is complete: eodhd_api_token in secrets.json.
    enabledByDefault: true,
    doctor: false,
    source: "plugins/eodhd",
    files: Object.freeze([
      "__init__.py",
      "contract.json",
      "plugin.yaml",
      "configuration.json",
      "configuration.py",
      "definition.py",
      "identity.py",
      "catalogue_pages.py",
      "series.py",
      "results.py",
      "stream.py",
      "stream_results.py",
      "session_context.py",
      "skills/eodhd/SKILL.md",
    ]),
    workers: Object.freeze([
      "eodhd-live.ts",
      "eodhd-stream-reference.ts",
      "eodhd-market-data.ts",
      "eodhd-market-data-operations.ts",
      "eodhd-market-data-values.ts",
      "eodhd-market-data-errors.ts",
      "eodhd-market-data-dashboard.ts",
      "eodhd-market-data-research.ts",
      "eodhd-market-data-fundamentals.ts",
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

/**
 * @typedef {object} ManagedPlugin
 * @property {string} name
 * @property {boolean} install
 * @property {boolean} enabledByDefault
 * @property {boolean} doctor
 * @property {string} source
 * @property {readonly string[]} files
 * @property {readonly string[]} [workers]
 */

/**
 * @param {any} paths
 * @param {string} apiKey
 * @param {{
 *   freshProfile?: boolean,
 *   execute?: (paths: any, args: string[], apiKey: string) => unknown,
 *   payloads?: readonly ManagedPlugin[],
 *   report?: (message: string) => void,
 * }} [options]
 */
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
