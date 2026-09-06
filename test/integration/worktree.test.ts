import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const repository = path.resolve(import.meta.dirname, "../..");
const worktreeScript = path.join(repository, "scripts", "worktree.mjs");
const temporaryRoots: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRepository() {
  const root = mkdtempSync(path.join(tmpdir(), "pythia-agent-worktree-"));
  temporaryRoots.push(root);
  const source = path.join(root, "source");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(path.join(source, "docs"), { recursive: true });
  writeFileSync(
    path.join(source, "package.json"),
    `${JSON.stringify({ name: "@pythia/agent", private: true }, null, 2)}\n`,
  );
  writeFileSync(path.join(source, "docs", "product.md"), "# Fixture\n");
  git(source, "init", "--initial-branch=main");
  git(source, "config", "user.name", "Pythia Test");
  git(source, "config", "user.email", "pythia@example.invalid");
  git(source, "add", ".");
  git(source, "commit", "-m", "fixture");
  return { root, source, worktrees };
}

function run(source: string, worktrees: string, ...args: string[]): string {
  return execFileSync(process.execPath, [worktreeScript, ...args], {
    cwd: source,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHIA_AGENT_WORKTREE_BASE: worktrees,
    },
  });
}

function directoryName(branch: string) {
  const safeName = branch
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (safeName === branch) return branch;
  const suffix = createHash("sha256").update(branch).digest("hex").slice(0, 8);
  return `${safeName || "branch"}-${suffix}`;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("managed contributor worktrees", () => {
  test("creates, lists, and removes a local branch worktree", () => {
    const { source, worktrees } = createRepository();
    const branch = "feature/research-view";
    git(source, "branch", branch);

    const output = run(source, worktrees, "create", branch);
    const worktree = path.join(worktrees, directoryName(branch));

    expect(output).toContain(`Worktree created at ${worktree}`);
    expect(existsSync(worktree)).toBe(true);
    expect(git(worktree, "branch", "--show-current")).toBe(branch);
    expect(run(source, worktrees, "list")).toContain(worktree);

    expect(run(source, worktrees, "remove", branch)).toContain(
      "Worktree removed.",
    );
    expect(existsSync(worktree)).toBe(false);
  });

  test("creates a local tracking branch for an origin-only branch", () => {
    const { root, source, worktrees } = createRepository();
    const remote = path.join(root, "origin.git");
    const branch = "remote-research";
    git(root, "init", "--bare", remote);
    git(source, "remote", "add", "origin", remote);
    git(source, "branch", branch);
    git(source, "push", "origin", branch);
    git(source, "branch", "--delete", branch);

    const output = run(source, worktrees, "create", branch);
    const worktree = path.join(worktrees, branch);

    expect(output).toContain(`Branch '${branch}' found on origin.`);
    expect(git(worktree, "branch", "--show-current")).toBe(branch);
    expect(git(worktree, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe(
      `origin/${branch}`,
    );
  });

  test("reports a clean stale worktree without removing it non-interactively", () => {
    const { root, source, worktrees } = createRepository();
    const remote = path.join(root, "origin.git");
    const branch = "completed-research";
    git(root, "init", "--bare", remote);
    git(source, "remote", "add", "origin", remote);
    git(source, "branch", branch);
    git(source, "push", "origin", branch);
    git(source, "branch", "--delete", branch);
    run(source, worktrees, "create", branch);
    git(source, "push", "origin", "--delete", branch);

    const worktree = path.join(worktrees, branch);
    const output = run(source, worktrees, "prune");

    expect(output).toContain(
      "The following managed worktrees have no remote branch:",
    );
    expect(output).toContain(`${worktree} (branch: ${branch})`);
    expect(existsSync(worktree)).toBe(true);
  });

  test("rejects a relative configured worktree base", () => {
    const { source } = createRepository();

    expect(() => run(source, "relative-worktrees", "create", "main")).toThrow(
      /PYTHIA_AGENT_WORKTREE_BASE must be an absolute path/u,
    );
  });
});
