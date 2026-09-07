import { readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

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
