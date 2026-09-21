import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { MANAGED_PLUGINS } from "../../scripts/dev/managed-plugins.mjs";

// Run with the exact prepared Hermes source/environment; no ambient accounts,
// provider calls or persistent services. The lifecycle owns the copied files.
const source = process.argv[2];
if (!source) throw Error("Pass the prepared pinned Hermes source directory.");
const root = mkdtempSync(join(tmpdir(), "pythia-financial-http-"));
try {
  // Copy the actual release allowlists, including the core platform package.
  // The financial feature's path-derived key needs no duplicate bare-name enable.
  for (const name of ["pythia", "pythia-market-data"]) {
    const plugin = MANAGED_PLUGINS.find((item) => item.name === name);
    if (!plugin) throw Error(`Missing managed plugin payload: ${name}`);
    const target = join(
      root,
      "plugins",
      ...(name === "pythia" ? [name] : ["finance", name]),
    );
    for (const file of plugin.files) {
      mkdirSync(dirname(join(target, file)), { recursive: true, mode: 0o700 });
      copyFileSync(
        join("runtime/managed", plugin.source, file),
        join(target, file),
      );
    }
  }
  writeFileSync(
    join(root, "config.yaml"),
    "plugins:\n  enabled: [pythia, finance/pythia-market-data, research/synthetic]\nplatform_toolsets:\n  api_server: [pythia-market-data, synthetic]\n",
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
  const report = JSON.parse(result.stdout.trim().split("\n").at(-1));
  const schemas = pathToFileURL(resolve("packages/market-data/src/search.ts"));
  const wireCheck = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import { readFileSync } from 'node:fs';
       const schemas = await import(${JSON.stringify(schemas.href)});
       const wire = JSON.parse(readFileSync(0, 'utf8'));
       schemas.investmentSearchResponseSchema.parse(wire.search);
       schemas.investmentAdoptResponseSchema.parse(wire.adopt);`,
    ],
    {
      input: JSON.stringify(report.shared_search_native_wire),
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  if (wireCheck.status !== 0)
    throw Error(
      wireCheck.stderr || "Native search wire consumer check failed.",
    );
  delete report.shared_search_native_wire;
  report.shared_search_native_discovery_adoption_and_ts_contracts = "passed";
  console.log(JSON.stringify(report));
} finally {
  rmSync(root, { recursive: true, force: true });
}
