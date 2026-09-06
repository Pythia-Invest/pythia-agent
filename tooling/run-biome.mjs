import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = [
  "apps",
  "packages",
  "runtime/managed/runner",
  "runtime/test",
  "scripts",
  "test",
  "tooling",
];
const rootFiles = [
  "biome.json",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "turbo.json",
  "vitest.root.config.mts",
];
const extension = /\.(?:[cm]?[jt]sx?|css|jsonc?)$/u;
const ignoredDirectories = new Set([
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

function files(path) {
  try {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          return [];
        }
        return files(entryPath);
      }
      return entry.isFile() && extension.test(entry.name) ? [entryPath] : [];
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

const targets = [...rootFiles, ...roots.flatMap(files)];
const result = spawnSync(
  "pnpm",
  ["exec", "biome", "check", "--error-on-warnings", ...targets],
  {
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
