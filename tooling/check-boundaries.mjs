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
// module, no private plugin-manager state and no dynamic import, so no plugin
// loads another plugin's modules. Core's private Hermes reads stay in the files
// ADR 0045 names. A line scan guards against the known patterns; it is not a
// sandbox.
const MANAGED = "runtime/managed";
// The pinned Hermes's top-level packages and modules (its pyproject), besides
// every `hermes_*` name, which includes `hermes_plugins`, the namespace Hermes
// loads plugins under.
const HERMES_MODULES = new Set([
  "acp_adapter",
  "agent",
  "batch_runner",
  "cli",
  "cron",
  "gateway",
  "mcp_serve",
  "model_tools",
  "plugins",
  "providers",
  "registration_lifecycle",
  "run_agent",
  "tools",
  "toolset_distributions",
  "toolsets",
  "trajectory_compressor",
  "tui_gateway",
  "utils",
]);
const isHermes = (module) =>
  HERMES_MODULES.has(module) || module.startsWith("hermes_");
// A statement starts a line or follows `;` or `:` (`if x: import tools`).
const IMPORT_STATEMENT =
  /(?:^|[;:])\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gu;
const FROM_STATEMENT = /(?:^|[;:])\s*from\s+([\w.]+)\s+import\b/gu;
const PRIVATE_MANAGER =
  /\b(?:_plugins|_registration_order|get_plugin_manager)\b/u;
// `sys.modules` also through `from sys import modules` or an aliased `sys`.
const DYNAMIC_IMPORT =
  /\b(?:importlib|import_module|__import__)\b|\bsys\.modules\b|\bfrom\s+sys\s+import\b.*\bmodules\b|\bimport\s+sys\s+as\b/u;

function importsHermes(line) {
  const modules = [
    ...[...line.matchAll(IMPORT_STATEMENT)].flatMap((match) =>
      match[1].split(",").map((item) => item.trim().split(/\s/u)[0]),
    ),
    ...[...line.matchAll(FROM_STATEMENT)].map((match) => match[1]),
  ];
  return modules.some((module) => isHermes(module.split(".")[0]));
}

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

// Lines joined across a trailing backslash, each with its first line number.
function logicalLines(text) {
  const lines = [];
  let pending = null;
  text.split("\n").forEach((line, index) => {
    pending = pending
      ? { ...pending, text: `${pending.text} ${line}` }
      : { number: index + 1, text: line };
    if (!line.endsWith("\\")) {
      lines.push(pending);
      pending = null;
    }
  });
  return pending ? [...lines, pending] : lines;
}

// Each rule is [test, reason, files allowed to match it].
function scanPython(root, rules) {
  for (const file of pythonFiles(join(MANAGED, root))) {
    const name = relative(join(MANAGED, root), file).split(sep).join("/");
    for (const line of logicalLines(readFileSync(file, "utf8"))) {
      for (const [test, reason, allowed] of rules) {
        if (!allowed.has(name) && test(line.text.replaceAll("\\", " "))) {
          violations.push(`${file}:${line.number}: ${reason}`);
        }
      }
    }
  }
}

const matches = (pattern) => (line) => pattern.test(line);
const nowhere = new Set();
scanPython("plugins", [
  [
    importsHermes,
    "plugins may not import Hermes; use pythia_platform",
    nowhere,
  ],
  [
    matches(PRIVATE_MANAGER),
    "plugins may not read Hermes's plugin manager",
    nowhere,
  ],
  [
    matches(DYNAMIC_IMPORT),
    "plugins may not import modules dynamically; use pythia_platform",
    nowhere,
  ],
]);
scanPython("core", [
  [
    matches(PRIVATE_MANAGER),
    "private plugin-manager reads belong in core/platform/harness.py",
    new Set(["platform/harness.py"]),
  ],
  [
    matches(/\b_clear_tool_defs_cache\b/u),
    "a new private Hermes read needs ADR 0045's list",
    new Set(["platform/access.py"]),
  ],
  [
    matches(/\b(?:_expected_api_key|_check_auth)\b/u),
    "a new private Hermes read needs ADR 0045's list",
    new Set(["platform/http.py"]),
  ],
]);

if (violations.length > 0) {
  throw new Error(`Workspace boundary check failed:\n${violations.join("\n")}`);
}
