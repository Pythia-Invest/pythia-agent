import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { MANAGED_PLUGINS } from "../../scripts/dev/managed-plugins.mjs";

// Run with the exact prepared Hermes source/environment; no ambient accounts,
// provider calls or persistent services. The lifecycle owns the copied files.
const source = process.argv[2];
if (!source) throw Error("Pass the prepared pinned Hermes source directory.");
const root = mkdtempSync(join(tmpdir(), "pythia-financial-http-"));
try {
  // Path-derived native keys must work without a duplicate bare-name enable.
  const target = join(root, "plugins", "finance", "pythia-market-data");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const feature = MANAGED_PLUGINS.find(
    (plugin) => plugin.name === "pythia-market-data",
  );
  for (const file of feature.files)
    copyFileSync(
      join("runtime/managed", feature.source, file),
      join(target, file),
    );
  writeFileSync(
    join(root, "config.yaml"),
    "plugins:\n  enabled: [finance/pythia-market-data]\nplatform_toolsets:\n  api_server: [pythia-market-data]\n",
    { mode: 0o600 },
  );
  writeFileSync(join(root, "secrets.json"), "{}", { mode: 0o600 });
  const result = spawnSync(
    join(source, ".venv/bin/python"),
    [resolve("tooling/qualification/financial_http.py"), root],
    {
      env: {
        HOME: root,
        HERMES_HOME: root,
        PYTHIA_CONFIG_ROOT: root,
        PYTHONPATH: source,
        PATH: process.env.PATH,
        HERMES_DISABLE_LAZY_INSTALLS: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  if (result.status !== 0)
    throw Error(
      result.stderr ||
        result.error?.message ||
        "Financial HTTP qualification failed.",
    );
  console.log(result.stdout.trim());
} finally {
  rmSync(root, { recursive: true, force: true });
}
