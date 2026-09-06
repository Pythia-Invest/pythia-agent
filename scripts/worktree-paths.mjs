import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const REPO_NAME = "@pythia/agent";
const DEFAULT_WORKTREE_BASE = join(homedir(), "worktrees-pythia-agent");
export const WORKTREE_BASE_ENV = "PYTHIA_AGENT_WORKTREE_BASE";

export function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function normalizePath(pathValue) {
  return existsSync(pathValue)
    ? realpathSync.native(pathValue)
    : resolve(pathValue);
}

function expandHomePath(pathValue) {
  if (pathValue === "~") return homedir();
  if (pathValue.startsWith("~/") || pathValue.startsWith("~\\")) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

export function resolveWorktreeBase() {
  const configured = (process.env[WORKTREE_BASE_ENV] ?? "").trim();
  if (!configured) return normalizePath(DEFAULT_WORKTREE_BASE);

  const expanded = expandHomePath(configured);
  if (!isAbsolute(expanded)) {
    die(
      `${WORKTREE_BASE_ENV} must be an absolute path or '~'-prefixed; got '${configured}'.`,
    );
  }
  return normalizePath(expanded);
}

export function validateBranchName(branch) {
  if (branch !== branch.trim() || branch.length === 0) {
    die("branch name cannot be empty or padded with whitespace.");
  }
  try {
    execFileSync("git", ["check-ref-format", "--branch", branch], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    die(`'${branch}' is not a valid git branch name.`);
  }
}

function worktreeDirectoryName(branch) {
  const safeName = branch
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (safeName === branch) return branch;
  const suffix = createHash("sha256").update(branch).digest("hex").slice(0, 8);
  return `${safeName || "branch"}-${suffix}`;
}

export function resolveManagedWorktreePath(branch) {
  const worktreeBase = resolveWorktreeBase();
  const worktreePath = normalizePath(
    join(worktreeBase, worktreeDirectoryName(branch)),
  );
  const rel = relative(worktreeBase, worktreePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    die(`resolved worktree path escaped ${worktreeBase}: ${worktreePath}`);
  }
  return { worktreeBase, worktreePath };
}

export function assertPythiaRepo(repoRoot) {
  const packageJsonPath = join(repoRoot, "package.json");
  if (
    !existsSync(packageJsonPath) ||
    !existsSync(join(repoRoot, "docs/product.md"))
  ) {
    die(
      `expected repository root for '${REPO_NAME}', but required project markers were not found at '${repoRoot}'.`,
    );
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    if (packageJson.name !== REPO_NAME) {
      die(
        `expected package name '${REPO_NAME}', but found '${packageJson.name}' at '${packageJsonPath}'.`,
      );
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      die(`could not parse '${packageJsonPath}': ${error.message}`);
    }
    throw error;
  }
}
