import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repository = path.resolve(import.meta.dirname, "../..");

function read(relative: string) {
  return readFileSync(path.join(repository, relative), "utf8");
}

describe("documented contributor and operator commands", () => {
  test("the root recipes expose refresh and explicit builder workflows", () => {
    const recipes = execFileSync("just", ["--summary"], {
      cwd: repository,
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/u);

    expect(recipes).toEqual(
      expect.arrayContaining([
        "ai-sync",
        "builder-sync",
        "check",
        "check-ai-workspace",
        "check-agents",
        "check-rules",
        "check-skills",
        "dev-refresh",
        "lint",
        "sync-agents",
        "sync-rules",
        "test",
        "audit",
        "worktree",
        "worktree-list",
        "worktree-prune",
        "worktree-remove",
      ]),
    );
  });

  test("public guides name only available lifecycle and development commands", () => {
    const justfile = read("justfile");
    const documentedJustCommands = [
      ...`${read("README.md")}\n${read("CONTRIBUTING.md")}\n${read("docs/development.md")}`.matchAll(
        /\bjust ([a-z][a-z0-9-]*)/gu,
      ),
    ].map((match) => match[1]);
    for (const command of documentedJustCommands) {
      expect(justfile).toMatch(new RegExp(`^${command}(?: [^:]*)?:`, "mu"));
    }

    const lifecycle = read("scripts/install/cli.mjs");
    const installedDocs = `${read("README.md")}\n${read("docs/install.md")}\n${read("docs/update-and-customization.md")}`;
    for (const command of [
      "status",
      "doctor",
      "auth",
      "check-update",
      "update",
      "rebuild",
      "recover",
      "uninstall",
    ]) {
      if (installedDocs.includes(`pythia ${command}`)) {
        expect(lifecycle).toContain(`case "${command}":`);
      }
    }
  });

  test("preview guidance keeps chosen-source activation separate from main updates", () => {
    const install = read("docs/install.md");
    const updates = read("docs/update-and-customization.md");

    expect(install).toContain("checked-out source exactly as it is");
    expect(install).toContain("uncommitted changes");
    expect(updates).toContain("pythia rebuild");
    expect(updates).toContain("does not fetch");
    expect(updates).toContain("origin/main");
    expect(updates).toContain("fast-forward");
  });

  test("recovery guidance follows the operation that owns the transaction", () => {
    const install = read("docs/install.md");
    const updates = read("docs/update-and-customization.md");

    expect(install).toMatch(/rerun\s+`.\/install\.sh --preview`/u);
    expect(install).not.toContain("run `pythia recover`");
    expect(updates).toContain("then run:\n\n```sh\npythia recover");
    expect(updates).toMatch(/rerun\s+`pythia rebuild`/u);
    expect(updates).toContain(
      "`pythia recover`\ndoes not resume install or rebuild transactions",
    );
  });
});
