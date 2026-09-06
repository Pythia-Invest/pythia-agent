/**
 * Cross-platform git worktree management for the pythia-agent repo.
 *
 * Subcommands:
 *   create <branch>  - create or attach a managed worktree for a branch
 *   remove <branch>  - remove a managed worktree
 *   list             - list all worktrees
 *   prune            - remove clean managed worktrees whose remote branch is gone
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { createInterface } from "node:readline";
import {
  assertPythiaRepo,
  die,
  normalizePath,
  resolveManagedWorktreePath,
  resolveWorktreeBase,
  validateBranchName,
  WORKTREE_BASE_ENV,
} from "./worktree-paths.mjs";

function git(args, opts = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf-8" }).trim();
  } catch (err) {
    if (opts.suppressErrors) return "";
    die(`git ${args[0]} failed: ${err.stderr || err.message}`);
  }
}

function gitSucceeds(args) {
  try {
    execFileSync("git", args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tryPull(dir) {
  try {
    execFileSync("git", ["-C", dir, "pull", "--ff-only"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    console.log("Pull skipped (no upstream or diverged).");
  }
}

function preflight() {
  if (!gitSucceeds(["rev-parse", "--is-inside-work-tree"])) {
    die("not inside a git repository.");
  }

  const repoRoot = normalizePath(git(["rev-parse", "--show-toplevel"]));
  assertPythiaRepo(repoRoot);

  const gitCommon = normalizePath(git(["rev-parse", "--git-common-dir"]));
  const gitDir = normalizePath(git(["rev-parse", "--git-dir"]));
  if (gitCommon !== gitDir) {
    die("run this from the main repository, not from inside a worktree.");
  }

  return { repoRoot };
}

function parseWorktreeList() {
  const raw = git(["worktree", "list", "--porcelain"]);
  if (!raw) return [];

  const entries = [];
  let current = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("worktree ")) {
      current = { worktree: line.slice("worktree ".length) };
      entries.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length);
    }
  }

  return entries;
}

function create(branch) {
  validateBranchName(branch);
  preflight();
  const { worktreeBase, worktreePath } = resolveManagedWorktreePath(branch);

  mkdirSync(worktreeBase, { recursive: true });

  const entries = parseWorktreeList();
  const existingWorktree = entries.find(
    (entry) => normalizePath(entry.worktree) === worktreePath,
  );

  if (existingWorktree) {
    console.log(`Worktree already exists at ${worktreePath}`);
    console.log("Pulling latest changes...");
    tryPull(worktreePath);
    console.log(`\n${worktreePath}`);
    return;
  }

  if (existsSync(worktreePath)) {
    die(
      `directory '${worktreePath}' exists but is not a registered worktree.\n` +
        `If stale, remove it manually after checking for local files.`,
    );
  }

  const branchRef = `refs/heads/${branch}`;
  const checkedOut = entries.find((entry) => entry.branch === branchRef);
  if (checkedOut) {
    die(`branch '${branch}' is already checked out in: ${checkedOut.worktree}`);
  }

  console.log("Fetching from origin...");
  git(["fetch", "origin", "--prune"], { suppressErrors: true });

  const hasLocal = gitSucceeds([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  const hasRemote = gitSucceeds([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/remotes/origin/${branch}`,
  ]);

  if (hasLocal) {
    console.log(`Branch '${branch}' found locally.`);
    git(["worktree", "add", worktreePath, branch]);
    console.log("Pulling latest changes...");
    tryPull(worktreePath);
  } else if (hasRemote) {
    console.log(`Branch '${branch}' found on origin.`);
    git(["worktree", "add", "-b", branch, worktreePath, `origin/${branch}`]);
  } else {
    console.error(`Error: branch '${branch}' not found locally or on origin.`);
    const similar = git(["branch", "-r", "--list", `origin/*${branch}*`], {
      suppressErrors: true,
    });
    if (similar) {
      console.error("Similar remote branches:");
      for (const line of similar.split(/\r?\n/).slice(0, 5)) {
        console.error(`  ${line.trim()}`);
      }
    }
    process.exit(1);
  }

  console.log(`Worktree created at ${worktreePath}`);
}

function list() {
  const output = git(["worktree", "list"]);
  console.log(output);
}

function remove(branch) {
  validateBranchName(branch);
  preflight();
  const { worktreePath } = resolveManagedWorktreePath(branch);
  const entries = parseWorktreeList();
  const found = entries.find(
    (entry) => normalizePath(entry.worktree) === worktreePath,
  );

  if (!found) {
    die(`no managed worktree found at '${worktreePath}'.`);
  }

  console.log(`Removing worktree: ${worktreePath}`);
  git(["worktree", "remove", worktreePath]);
  console.log("Worktree removed.");
}

function prompt(question) {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(answer);
    });
  });
}

async function prune() {
  const { repoRoot } = preflight();
  const worktreeBase = resolveWorktreeBase();

  console.log("Fetching from origin...");
  git(["fetch", "origin", "--prune"]);

  const entries = parseWorktreeList();
  const secondaryEntries = entries.filter(
    (entry) => normalizePath(entry.worktree) !== repoRoot,
  );

  if (secondaryEntries.length === 0) {
    console.log("\nNo worktrees to prune.");
    return;
  }

  const candidates = [];
  const skipped = [];

  for (const entry of secondaryEntries) {
    const normalizedPath = normalizePath(entry.worktree);
    const rel = relative(worktreeBase, normalizedPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      skipped.push(`${entry.worktree} - outside ${WORKTREE_BASE_ENV}`);
      continue;
    }

    if (!entry.branch) continue;

    const branchMatch = entry.branch.match(/^refs\/heads\/(.+)$/);
    if (!branchMatch) continue;
    const branchName = branchMatch[1];

    const hasRemote = gitSucceeds([
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${branchName}`,
    ]);
    if (hasRemote) continue;

    let dirtyOutput;
    try {
      dirtyOutput = execFileSync(
        "git",
        ["-C", entry.worktree, "status", "--porcelain"],
        { encoding: "utf-8" },
      ).trim();
    } catch {
      skipped.push(
        `${entry.worktree} (branch: ${branchName}) - could not check status`,
      );
      continue;
    }

    if (dirtyOutput) {
      skipped.push(
        `${entry.worktree} (branch: ${branchName}) - has uncommitted changes`,
      );
    } else {
      candidates.push({ path: entry.worktree, branch: branchName });
    }
  }

  if (skipped.length > 0) {
    console.log("\nSkipped:");
    for (const entry of skipped) {
      console.log(`  ${entry}`);
    }
  }

  if (candidates.length === 0) {
    console.log("\nNo worktrees to prune.");
    return;
  }

  console.log("\nThe following managed worktrees have no remote branch:");
  for (const candidate of candidates) {
    console.log(`  ${candidate.path} (branch: ${candidate.branch})`);
  }
  console.log("");

  if (!process.stdin.isTTY) return;

  const answer = await prompt(
    `Remove these ${candidates.length} worktrees? [y/N] `,
  );
  if (answer !== "y" && answer !== "Y") {
    console.log("Aborted.");
    return;
  }

  console.log("");
  let removed = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      execFileSync("git", ["worktree", "remove", candidate.path], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      console.log(`  Removed: ${candidate.path}`);
      removed++;
    } catch {
      console.error(`  Failed:  ${candidate.path}`);
      failed++;
    }
  }

  console.log(`\nDone. Removed ${removed} worktree(s).`);
  if (failed > 0) {
    console.log(`Failed to remove ${failed} worktree(s).`);
  }
}

const args = process.argv.slice(2);
const subcommand = args[0];

switch (subcommand) {
  case "create": {
    const branch = args[1];
    if (!branch) die("usage: node scripts/worktree.mjs create <branch>");
    create(branch);
    break;
  }
  case "remove": {
    const branch = args[1];
    if (!branch) die("usage: node scripts/worktree.mjs remove <branch>");
    remove(branch);
    break;
  }
  case "list":
    list();
    break;
  case "prune":
    await prune();
    break;
  default:
    die("usage: node scripts/worktree.mjs <create|remove|list|prune> [branch]");
}
