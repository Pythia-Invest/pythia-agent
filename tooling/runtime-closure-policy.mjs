import { readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  MANAGED_PLUGINS,
  managedRunnerFiles,
} from "../scripts/dev/managed-plugins.mjs";
import { MANAGED_WIDGET_BUILDS } from "../scripts/dev/managed-widget-builds.mjs";

export const root = resolve(import.meta.dirname, "..");
export const violations = [];
const forbiddenSourcePrefixes = [
  ".agents/",
  "apps/design-lab/",
  "docs/",
  "runtime/test/",
  "test/",
];
const personalName = ["ra", "lph"].join("");
const privateRepository = ["pythia", "-invest"].join("");
export const forbiddenPayloadText = [
  `/Users/${personalName}/${privateRepository}`,
  `/home/${personalName}/`,
  "plans/main",
  "grilling-",
  "Design Lab",
  ".agents/",
  "runtime/test/fixtures",
];

/**
 * Managed release inputs: copied plugin files and connector runner files, plus
 * each compiled output (widget bundles, `build:runtime` workers) mapped to the
 * public source it is built from.
 */
export function releaseInputs() {
  const runner = (path) => `runtime/managed/runner/${path}`;
  const workers = managedRunnerFiles(MANAGED_PLUGINS);
  return {
    files: [
      ...MANAGED_PLUGINS.flatMap((plugin) =>
        plugin.files.map((path) => `runtime/managed/${plugin.source}/${path}`),
      ),
      ...workers
        .flatMap((files) => [...files.sources, ...files.compiled])
        .map(runner),
    ],
    builds: new Map([
      ...MANAGED_WIDGET_BUILDS.map((build) => [build.output, build.entry]),
      ...workers.flatMap(({ sources, compiled }) =>
        compiled.map((path, index) => [runner(path), runner(sources[index])]),
      ),
    ]),
  };
}

export function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : entry.isFile() ? [child] : [];
  });
}

export function normalized(path) {
  return path.split(sep).join("/");
}

export function isBuilderInstructionSource(sourcePath) {
  if (sourcePath === "AGENTS.md" || sourcePath.startsWith(".agents/")) {
    return true;
  }
  return (
    sourcePath.endsWith("/AGENTS.md") &&
    !sourcePath.startsWith("runtime/seeds/") &&
    !sourcePath.startsWith("runtime/managed/skills/")
  );
}

export function rejectSourcePath(path, owner) {
  const sourcePath = normalized(relative(root, path));
  if (
    isBuilderInstructionSource(sourcePath) ||
    forbiddenSourcePrefixes.some((prefix) => sourcePath.startsWith(prefix))
  ) {
    violations.push(`${owner}: reaches development-only source ${sourcePath}`);
  }
}
