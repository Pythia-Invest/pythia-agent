import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [task, ...arguments_] = process.argv.slice(2);

if (!task) {
  throw new Error("Usage: node tooling/run-turbo.mjs <task> [turbo arguments]");
}

function workspaceDirectories(parent) {
  try {
    return readdirSync(parent)
      .map((entry) => join(parent, entry))
      .filter((path) => statSync(path).isDirectory())
      .filter((path) => {
        try {
          statSync(join(path, "package.json"));
          return true;
        } catch {
          return false;
        }
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

const workspaces = [
  ...workspaceDirectories("apps"),
  ...workspaceDirectories("packages"),
];

if (workspaces.length === 0) {
  process.exit(0);
}

const filters = workspaces.flatMap((workspace) => [
  "--filter",
  `./${workspace}`,
]);
const result = spawnSync(
  "pnpm",
  ["exec", "turbo", "run", task, ...filters, ...arguments_],
  {
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
