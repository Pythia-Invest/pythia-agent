import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { refreshManagedPlugins } from "../../scripts/dev/managed-plugins.mjs";

// An isolated native discovery check: no listener, provider or model execution.
const source = process.argv[2];
if (!source) throw Error("Pass the prepared pinned Hermes source directory.");
const repository = resolve(import.meta.dirname, "../..");
const root = mkdtempSync(join(tmpdir(), "pythia-plugin-skills-"));
try {
  const managedRoot = join(repository, "runtime/managed");
  const paths = {
    profileRoot: root,
    managedRoot,
    managedCore: join(managedRoot, "core"),
  };
  refreshManagedPlugins(paths, "synthetic", { execute: () => {} });
  const bundled = join(root, "empty-bundled");
  mkdirSync(bundled);
  const qualified = "pythia-market-data:market-data";
  const platformPath = join(root, "plugins/pythia/platform/__init__.py");
  const platformSource = readFileSync(platformPath, "utf8");
  for (const { enabled, available, skillConfig, widgets = true } of [
    { enabled: true, available: true, skillConfig: "" },
    { enabled: false, available: false, skillConfig: "" },
    {
      enabled: true,
      available: false,
      skillConfig: `  disabled: [${qualified}]\n`,
    },
    {
      enabled: true,
      available: false,
      skillConfig: `  platform_disabled:\n    api_server: [${qualified}]\n`,
    },
    { enabled: true, available: true, skillConfig: "", widgets: false },
  ]) {
    // Simulate a preserved older core that still exports API v1 but predates
    // widget support. Native financial registration must remain usable.
    writeFileSync(
      platformPath,
      widgets
        ? platformSource
        : platformSource.replace(
            "from .widgets import register_widget_presentation\n",
            "",
          ),
    );
    writeFileSync(
      join(root, "config.yaml"),
      `plugins:\n  enabled: [pythia, pythia-market-data]\n  disabled: ${enabled ? "[]" : "[pythia-market-data]"}\nplatform_toolsets:\n  api_server: [pythia-market-data, file]\nskills:\n  external_dirs: [${JSON.stringify(join(managedRoot, "skills"))}]\n${skillConfig}`,
      { mode: 0o600 },
    );
    const result = spawnSync(
      join(source, ".venv/bin/python"),
      [
        join(repository, "tooling/qualification/plugin_skills.py"),
        root,
        String(enabled),
        String(available),
        String(widgets),
      ],
      {
        env: {
          HOME: root,
          HERMES_HOME: root,
          HERMES_PLATFORM: "api_server",
          HERMES_BUNDLED_PLUGINS: bundled,
          HERMES_DISABLE_LAZY_INSTALLS: "1",
          PYTHIA_CONFIG_ROOT: root,
          PYTHIA_MANAGED_ROOT: managedRoot,
          PYTHONPATH: source,
          PYTHONDONTWRITEBYTECODE: "1",
          PATH: process.env.PATH,
        },
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    if (result.status !== 0)
      throw Error(result.stderr || result.error?.message || result.stdout);
    if (
      !widgets &&
      !result.stderr.includes("widget presentations are unavailable")
    )
      throw Error("Missing visible stale-core widget warning.");
    console.log(result.stdout.trim());
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
