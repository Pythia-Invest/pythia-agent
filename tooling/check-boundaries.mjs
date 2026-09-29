import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["apps", "packages"];
const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;
const IMPORT_PATTERN =
  /(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/gu;
const ignoredDirectories = new Set([
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const violations = [];

function directories(parent) {
  if (!existsSync(parent)) {
    return [];
  }
  return readdirSync(parent)
    .map((entry) => join(parent, entry))
    .filter((path) => statSync(path).isDirectory())
    .filter((path) => existsSync(join(path, "package.json")));
}

function files(path) {
  const found = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      found.push(...files(entryPath));
    } else if (entry.isFile() && SOURCE_PATTERN.test(entry.name)) {
      found.push(entryPath);
    }
  }
  return found;
}

function directDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

function declaredWorkspaceVersion(manifest, dependency) {
  return (
    manifest.dependencies?.[dependency] ??
    manifest.devDependencies?.[dependency] ??
    manifest.peerDependencies?.[dependency]
  );
}

const workspaces = ROOTS.flatMap((root) =>
  directories(root).map((path) => ({
    path,
    kind: root,
    manifest: JSON.parse(readFileSync(join(path, "package.json"), "utf8")),
  })),
);
function markdownFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  });
}
const byName = new Map(
  workspaces.map((workspace) => [workspace.manifest.name, workspace]),
);
const decisions = existsSync("docs/decisions")
  ? markdownFiles("docs/decisions")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n")
  : "";

for (const workspace of workspaces) {
  const { manifest, path, kind } = workspace;
  if (
    typeof manifest.name !== "string" ||
    !manifest.name.startsWith("@pythia/")
  ) {
    violations.push(
      `${path}/package.json: workspace name must begin with @pythia/`,
    );
  }
  if (kind === "packages" && !decisions.includes(manifest.name)) {
    violations.push(
      `${path}/package.json: new package ${manifest.name} needs a one-line reason in docs/decisions/`,
    );
  }
  const dependencies = directDependencies(manifest);
  for (const dependency of dependencies) {
    const target = byName.get(dependency);
    if (
      target &&
      declaredWorkspaceVersion(manifest, dependency) !== "workspace:*"
    ) {
      violations.push(
        `${path}/package.json: internal dependency ${dependency} must use workspace:*`,
      );
    }
    if (kind === "packages" && target?.kind === "apps") {
      violations.push(
        `${path}/package.json: packages may not depend on apps (${dependency})`,
      );
    }
  }
  for (const file of files(path)) {
    const contents = readFileSync(file, "utf8");
    const isTest = relative(path, file)
      .split(sep)
      .some((part) => part === "test" || part === "e2e");
    for (const match of contents.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      if (!specifier) {
        continue;
      }
      const internal = [...byName.keys()].find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (internal) {
        if (internal !== manifest.name && !dependencies.has(internal)) {
          violations.push(
            `${file}: ${internal} must be a direct declared dependency`,
          );
        }
        const subpath = `.${specifier.slice(internal.length)}`;
        const exports = byName.get(internal)?.manifest.exports;
        const publicSubpath =
          exports !== null &&
          typeof exports === "object" &&
          Object.hasOwn(exports, subpath) &&
          exports[subpath] !== null;
        if (specifier !== internal && !publicSubpath) {
          violations.push(
            `${file}: internal imports must use a declared public ${internal} entrypoint`,
          );
        }
        if (kind === "packages" && byName.get(internal)?.kind === "apps") {
          violations.push(
            `${file}: packages may not import apps (${internal})`,
          );
        }
      }
      if (kind === "packages" && specifier.startsWith("@pythia/apps/")) {
        violations.push(`${file}: packages may not import app source`);
      }
      if (specifier.includes("/test/") && !isTest) {
        violations.push(
          `${file}: production source may not import test-only code`,
        );
      }
    }
  }
}

// Plugins reach Pythia only through `pythia_platform` (ADR 0045): no Hermes
// module, no private plugin-manager state and no computed import of another
// plugin's modules. Core's private Hermes reads stay in one adapter file.
const MANAGED = "runtime/managed";
const HERMES_IMPORT =
  /^\s*(?:from|import)\s+(?:hermes_cli|tools|gateway|model_tools|hermes_state|hermes_constants|agent|hermes_plugins)(?:[.\s,]|$)/u;
const PRIVATE_HERMES =
  /\b(?:_plugins|_registration_order|get_plugin_manager)\b/u;
const COMPUTED_IMPORT = /\b(?:import_module|__import__)\(\s*(?!["']\.)/u;
// Temporary: W2-toolkit moves market-data's connector toolkit into core,
// switches these files to `pythia_platform` and empties this list.
const PLUGIN_EXCEPTIONS = new Set([
  "coingecko/__init__.py",
  "coinmarketcap/__init__.py",
  "eodhd/__init__.py",
  "eodhd/definition.py",
  "eodhd/stream.py",
  "gleif/__init__.py",
  "market-data/__init__.py",
  "market-data/contributions.py",
  "market-data/execution.py",
  "market-data/process.py",
  "market-data/subscriptions.py",
  "market-data/worker_reads.py",
  "nsm/__init__.py",
  "openfigi/__init__.py",
  "openfigi/client.py",
  "sec/__init__.py",
  "sec/client.py",
  "xbrl-filings/__init__.py",
  "yahoo-discovery/__init__.py",
]);

function pythonFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__pycache__" ? [] : pythonFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".py") ? [entryPath] : [];
  });
}

// An exempt file must still need its exception, so the list only shrinks.
function scanPython(root, rules, exempt) {
  const needed = new Set();
  for (const file of pythonFiles(join(MANAGED, root))) {
    const name = relative(join(MANAGED, root), file).split(sep).join("/");
    const found = readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        rules
          .filter(([pattern]) => pattern.test(line))
          .map(([, reason]) => `${file}:${index + 1}: ${reason}`),
      );
    if (!exempt.has(name)) {
      violations.push(...found);
    } else if (found.length > 0) {
      needed.add(name);
    }
  }
  for (const name of exempt) {
    if (!needed.has(name)) {
      violations.push(
        `${join(MANAGED, root, name)}: remove its unused exception`,
      );
    }
  }
}

scanPython(
  "plugins",
  [
    [HERMES_IMPORT, "plugins may not import Hermes; use pythia_platform"],
    [PRIVATE_HERMES, "plugins may not read Hermes's plugin manager"],
    [COMPUTED_IMPORT, "plugins may not import computed module names"],
  ],
  PLUGIN_EXCEPTIONS,
);
scanPython(
  "core",
  [[PRIVATE_HERMES, "private Hermes reads belong in core/platform/harness.py"]],
  new Set(["platform/harness.py"]),
);

if (violations.length > 0) {
  throw new Error(`Workspace boundary check failed:\n${violations.join("\n")}`);
}
