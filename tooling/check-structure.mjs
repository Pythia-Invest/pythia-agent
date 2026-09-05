import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

const WORKSPACE_ROOTS = ["apps", "packages"];
const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".mts",
]);
const IGNORED_DIRECTORIES = new Set([
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const violations = [];

function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "shared" || entry.name === "utils") {
        violations.push(
          `${entryPath}: broad ${entry.name}/ directories are not allowed`,
        );
      }
      walk(entryPath);
      continue;
    }
    if (
      !entry.isFile() ||
      !SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))
    ) {
      continue;
    }
    const lines = readFileSync(entryPath, "utf8").split("\n");
    const isTest = entryPath.split(sep).includes("test");
    const maximum = isTest ? 600 : 400;
    if (
      lines.length > maximum &&
      !lines[0]?.includes("pythia-structure-ignore:")
    ) {
      violations.push(
        `${entryPath}: ${lines.length} lines exceeds ${maximum}; split it or add a reasoned first-line pythia-structure-ignore`,
      );
    }
    if (lines.some((line) => line.includes("@ts-ignore"))) {
      violations.push(`${entryPath}: @ts-ignore is not allowed`);
    }
    if (
      lines.some(
        (line) => line.includes("@ts-expect-error") && !line.includes("--"),
      )
    ) {
      violations.push(
        `${entryPath}: @ts-expect-error needs an adjacent explanation after --`,
      );
    }
  }
}

for (const root of WORKSPACE_ROOTS) {
  if (existsSync(root)) {
    walk(root);
  }
}

if (violations.length > 0) {
  throw new Error(`Structure check failed:\n${violations.join("\n")}`);
}
