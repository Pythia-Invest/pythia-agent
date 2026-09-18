import { lstatSync } from "node:fs";
import { join } from "node:path";
import { MANAGED_PLUGIN_FILES, refreshManagedPlugin } from "./files.mjs";
import { hermesRun } from "./runtime-config.mjs";

// Release payloads, not an enabled-plugin inventory. Native Hermes owns discovery
// and all plugin/platform choices. Keep every installed helper explicit here.
export const MANAGED_PLUGINS = Object.freeze([
  Object.freeze({
    name: "pythia",
    doctor: true,
    source: "plugin",
    files: MANAGED_PLUGIN_FILES,
  }),
  Object.freeze({
    name: "pythia-market-data",
    doctor: true,
    source: "plugins/market-data",
    files: Object.freeze([
      "__init__.py",
      "plugin.yaml",
      "backend.py",
      "cache.py",
      "coordinated.py",
      "delivery.py",
      "http_transport.py",
      "admission.py",
      "live.py",
      "live_http.py",
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
    ]),
  }),
]);

function assertSource(directory, files) {
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  ) {
    throw new Error(
      `Managed runtime source must be a real directory: ${directory}`,
    );
  }
  for (const filename of files) {
    const path = join(directory, filename);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Managed runtime input must be a regular file: ${path}`);
    }
  }
}

export function refreshManagedPlugins(
  paths,
  apiKey,
  { freshProfile = false, execute = hermesRun } = {},
) {
  const copies = MANAGED_PLUGINS.map((plugin) => ({
    ...plugin,
    source:
      plugin.name === "pythia"
        ? paths.managedPlugin
        : join(paths.managedRoot, plugin.source),
    destination: join(paths.profileRoot, "plugins", plugin.name),
  }));
  // Validate the entire input set before replacing any copied plugin. The worker
  // is read directly from the selected managed source, like the SEC runner.
  for (const plugin of copies) assertSource(plugin.source, plugin.files);
  for (const plugin of copies) {
    refreshManagedPlugin(plugin.source, plugin.destination, plugin.files);
  }
  for (const plugin of copies.filter((plugin) => plugin.doctor)) {
    execute(
      paths,
      ["-p", paths.profile, "plugins", "doctor", plugin.destination, "--ci"],
      apiKey,
    );
  }
  if (freshProfile) {
    for (const plugin of copies) {
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
}
