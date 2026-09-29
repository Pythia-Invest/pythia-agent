import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  copySourceSnapshot,
  derivePredecessor,
  directoryManifest,
  sourceManifest,
  synchronizeSnapshot,
} from "../../tooling/source-snapshot.mjs";

export const repositoryRoot = resolve(import.meta.dirname, "../..");
const predecessorSpecification = join(
  repositoryRoot,
  "test/fixtures/releases/technical-preview-a.json",
);

const roots: string[] = [];

export function cleanupReleaseFixtures() {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Under the checkout's ignored .local, not the system temp directory:
 * fixtures that compile TypeScript resolve @types/node from the repository's
 * node_modules by walking up.
 */
export function temporaryQualificationRoot(label: string) {
  const parent = join(repositoryRoot, ".local", "qualification");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, `${label}-`));
  roots.push(root);
  return root;
}

export function run(
  cwd: string,
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function git(cwd: string, args: string[], environment = process.env) {
  return run(cwd, "git", args, {
    ...environment,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  });
}

function gitEnvironment() {
  return {
    ...process.env,
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
}

function commit(repository: string, message: string) {
  git(repository, ["add", "-A"]);
  git(repository, ["commit", "-m", message], gitEnvironment());
  return git(repository, ["rev-parse", "HEAD"]);
}

function signedTag(repository: string, key: string, tag: string) {
  git(
    repository,
    [
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${key}`,
      "tag",
      "-s",
      tag,
      "-m",
      tag,
    ],
    gitEnvironment(),
  );
}

function initializeRepository(repository: string) {
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.name", "Pythia qualification"]);
  git(repository, ["config", "user.email", "qualification@invalid.example"]);
  git(repository, ["config", "commit.gpgSign", "false"]);
  git(repository, ["config", "tag.gpgSign", "false"]);
  git(repository, ["config", "core.hooksPath", "/dev/null"]);
  git(repository, ["config", "core.autocrlf", "false"]);
  git(repository, ["config", "core.fileMode", "true"]);
}

function signingIdentity(root: string, label: string) {
  const key = join(root, `ephemeral-${label}-key`);
  run(root, "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
  const signerLine = `${label}@invalid.example namespaces="git" ${publicKey}\n`;
  const allowedSigners = join(root, `ephemeral-${label}-allowed-signers`);
  writeFileSync(allowedSigners, signerLine, { mode: 0o600 });
  return { allowedSigners, key, signerLine };
}

export function createSnapshotFixture({ signedOverlay = false } = {}) {
  const root = temporaryQualificationRoot("release");
  const exactB = join(root, "exact-b");
  const predecessorA = join(root, "predecessor-a");
  const repository = join(root, "repository");
  const remote = join(root, "origin.git");
  const clone = join(root, "clone");
  const signing = signingIdentity(root, "qualification");

  copySourceSnapshot(repositoryRoot, exactB);
  copySourceSnapshot(repositoryRoot, predecessorA);
  derivePredecessor(predecessorA, predecessorSpecification);
  if (signedOverlay) {
    for (const snapshot of [exactB, predecessorA]) {
      writeFileSync(
        join(snapshot, "release/allowed_signers"),
        signing.signerLine,
        {
          mode: 0o644,
        },
      );
    }
  }

  mkdirSync(repository);
  initializeRepository(repository);
  synchronizeSnapshot(predecessorA, repository);
  const revisionA = commit(repository, "technical preview A");
  signedTag(repository, signing.key, "v0.0.1");

  synchronizeSnapshot(exactB, repository);
  const revisionB = commit(repository, "release B");
  signedTag(repository, signing.key, "v0.1.0");

  git(root, ["init", "--bare", "--initial-branch=main", remote]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, [
    "push",
    "origin",
    "main",
    "refs/tags/v0.0.1",
    "refs/tags/v0.1.0",
  ]);
  git(root, ["clone", remote, clone]);

  return {
    ...signing,
    clone,
    remote,
    revisionA,
    revisionB,
    root,
    source: sourceManifest(repositoryRoot),
    snapshotB: directoryManifest(exactB),
  };
}
