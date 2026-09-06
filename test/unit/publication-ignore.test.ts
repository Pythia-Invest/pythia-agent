import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps device artifacts private without hiding model API source", () => {
  const root = mkdtempSync(join(tmpdir(), "pythia-ignore-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    copyFileSync(
      new URL("../../.gitignore", import.meta.url),
      join(root, ".gitignore"),
    );
    const ignored = (path: string) =>
      spawnSync("git", ["check-ignore", "--no-index", path], { cwd: root })
        .status === 0;
    for (const path of [
      ".private/grilling.md",
      ".local/auth.json",
      ".env",
      "nested/.env.local",
      "auth.json",
      "nested/auth.json",
      "docs/examples/auth.json",
      "docs/examples/.env.local",
      "docs/examples/private.key",
      "logs/run.log",
      "state.sqlite3",
      "models/weights.bin",
      "node_modules/package/index.js",
    ])
      expect(ignored(path), path).toBe(true);
    for (const path of [
      "apps/desk/src/app/api/models/route.ts",
      "runtime/managed/skills/research/SKILL.md",
      "apps/desk/test/model-catalog.test.ts",
      ".env.example",
      "docs/development.md",
      "docs/examples/client.ts",
      "docs/examples/.env.example",
    ])
      expect(ignored(path), path).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
