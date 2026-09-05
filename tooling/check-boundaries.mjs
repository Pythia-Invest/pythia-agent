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
    const isTest = relative(path, file).split(sep).includes("test");
    for (const match of contents.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      if (!specifier) {
        continue;
      }
      const internal = [...byName.keys()].find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (internal) {
        if (!dependencies.has(internal)) {
          violations.push(
            `${file}: ${internal} must be a direct declared dependency`,
          );
        }
        if (specifier !== internal) {
          violations.push(
            `${file}: internal imports must use the public ${internal} entrypoint`,
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

if (violations.length > 0) {
  throw new Error(`Workspace boundary check failed:\n${violations.join("\n")}`);
}
