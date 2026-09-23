// Isolated copied native qualification; build managed widgets before running.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const repo = resolve(import.meta.dirname, "../..");
const { refreshManagedPlugins } = await import(
  join(repo, "scripts/dev/managed-plugins.mjs")
);
const source = process.argv[2];
if (!source) throw Error("Pass the prepared pinned Hermes source directory.");
const root = mkdtempSync(join(tmpdir(), "research-visual-native-"));
try {
  const managedRoot = join(repo, "runtime/managed");
  refreshManagedPlugins(
    { profileRoot: root, managedRoot, managedCore: join(managedRoot, "core") },
    "synthetic",
    { execute: () => {} },
  );
  mkdirSync(join(root, "empty-bundled"));
  mkdirSync(join(root, "workspace"));
  writeFileSync(
    join(root, "fixture.json"),
    JSON.stringify({
      format: "pythia-visual",
      version: 1,
      title: "Synthetic valuation",
      summary: "Synthetic earnings model for native qualification.",
      presentation: {
        plugin: "pythia-vega-lite",
        widget: "research-visual",
        input_contract: "pythia.vega-lite.v1",
      },
      data: {
        kind: "vega-lite",
        asOf: "2026-09-19",
        sources: [],
        assumptions: ["Synthetic values"],
        spec: {
          data: {
            values: [
              { year: 2025, revenue: 100 },
              { year: 2026, revenue: 110 },
            ],
          },
          params: [
            {
              name: "growth",
              value: 0.05,
              bind: { input: "range", min: 0, max: 1 },
            },
          ],
          transform: [
            { calculate: "datum.revenue * (1 + growth)", as: "projection" },
          ],
          mark: "bar",
          encoding: {
            x: { field: "year", type: "ordinal" },
            y: { field: "projection", type: "quantitative" },
          },
        },
        parameters: { growth: 0.1 },
      },
    }),
  );
  for (const mode of ["enabled", "disabled"]) {
    writeFileSync(
      join(root, "config.yaml"),
      `plugins:\n  enabled: [pythia, pythia-vega-lite]\n  disabled: ${mode === "disabled" ? "[pythia-vega-lite]" : "[]"}\nplatform_toolsets:\n  api_server: [pythia-vega-lite]\n`,
    );
    const result = spawnSync(
      join(source, ".venv/bin/python"),
      [join(repo, "tooling/qualification/research_visuals.py"), mode],
      {
        cwd: root,
        env: {
          HOME: root,
          HERMES_HOME: root,
          HERMES_PLATFORM: "api_server",
          HERMES_BUNDLED_PLUGINS: join(root, "empty-bundled"),
          HERMES_DISABLE_LAZY_INSTALLS: "1",
          PYTHIA_WORKSPACE: join(root, "workspace"),
          PYTHIA_NODE: process.execPath,
          PYTHIA_CONFIG_ROOT: root,
          PYTHIA_MANAGED_ROOT: managedRoot,
          PYTHONPATH: source,
          PYTHONDONTWRITEBYTECODE: "1",
          PATH: process.env.PATH,
        },
        encoding: "utf8",
        timeout: 45000,
      },
    );
    if (result.status !== 0)
      throw Error(result.stderr || result.stdout || String(result.error));
    console.log(result.stdout.trim());
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
