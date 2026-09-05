import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonIfPresent } from "../install/files.mjs";

export const STABLE_TAG =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

export class ReleaseError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ReleaseError";
    this.code = code;
  }
}

export function runGit(repository, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    env: options.environment ?? process.env,
    input: options.input,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: options.timeout ?? 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new ReleaseError(
      `git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
      options.code ?? "git_failed",
    );
  }
  return String(result.stdout ?? "").trim();
}

function semverParts(tag) {
  const match = STABLE_TAG.exec(tag);
  if (!match) return null;
  return match.slice(1).map(BigInt);
}

export function compareStableTags(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) throw new ReleaseError("Invalid stable tag.", "invalid_tag");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function configuredSigners(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function assertTrustRoot(path) {
  const signers = configuredSigners(path);
  if (signers.length === 0) {
    throw new ReleaseError(
      "No trusted release signer is configured. Stable releases remain disabled until the release owner publishes the first SSH signer.",
      "trust_root_empty",
    );
  }
  return signers;
}

export function verifyStableTag(repository, tag, allowedSigners) {
  if (!STABLE_TAG.test(tag)) {
    throw new ReleaseError(
      `Stable release name is invalid: ${tag}`,
      "invalid_tag",
    );
  }
  assertTrustRoot(allowedSigners);
  const reference = `refs/tags/${tag}`;
  if (runGit(repository, ["cat-file", "-t", reference]) !== "tag") {
    throw new ReleaseError(`${tag} is not an annotated tag.`, "unsigned_tag");
  }
  runGit(
    repository,
    [
      "-c",
      "gpg.format=ssh",
      "-c",
      `gpg.ssh.allowedSignersFile=${allowedSigners}`,
      "verify-tag",
      reference,
    ],
    { code: "untrusted_tag" },
  );
  return runGit(repository, ["rev-parse", "--verify", `${reference}^{commit}`]);
}

export function currentCheckout(repository) {
  const head = runGit(repository, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const status = runGit(repository, [
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
  ]);
  const conflicted = runGit(repository, [
    "diff",
    "--name-only",
    "--diff-filter=U",
  ]);
  return {
    head,
    clean: status === "" && conflicted === "",
    status,
    conflicted,
  };
}

export function assertCleanCheckout(repository) {
  const checkout = currentCheckout(repository);
  if (!checkout.clean) {
    throw new ReleaseError(
      "The managed checkout is dirty or conflicted. Pythia will not stash, merge, rebase, reset, or overwrite local work.",
      "dirty_checkout",
    );
  }
  return checkout;
}

function remoteUrl(repository) {
  const value = runGit(repository, ["remote", "get-url", "origin"], {
    code: "remote_unavailable",
  });
  if (/^https?:\/\//u.test(value)) {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      throw new ReleaseError(
        "The origin URL contains embedded credentials. Use Git's credential helper instead.",
        "unsafe_remote_url",
      );
    }
  }
  return value;
}

function remoteTags(repository) {
  const lines = runGit(
    repository,
    ["ls-remote", "--tags", "--refs", "origin", "v*"],
    { code: "release_discovery_failed" },
  );
  return lines
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length === 2)
    .map(([_object, reference]) => ({
      tag: reference?.replace(/^refs\/tags\//u, "") ?? "",
    }))
    .filter((item) => STABLE_TAG.test(item.tag));
}

function verifyRemoteTag(repository, tag, allowedSigners) {
  const directory = mkdtempSync(join(tmpdir(), "pythia-release-check-"));
  try {
    runGit(directory, ["init", "--bare", "."]);
    runGit(directory, [
      "-c",
      "core.hooksPath=/dev/null",
      "fetch",
      "--no-tags",
      remoteUrl(repository),
      `refs/tags/${tag}:refs/tags/${tag}`,
    ]);
    return verifyStableTag(directory, tag, allowedSigners);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function installedIdentity(paths) {
  const release = readJsonIfPresent(paths.releaseFile);
  const installation = readJsonIfPresent(paths.installFile);
  if (!release || !installation) {
    throw new ReleaseError(
      "Pythia installation metadata is missing.",
      "not_installed",
    );
  }
  if (!["stable", "preview"].includes(release.channel)) {
    throw new ReleaseError(
      "The stored release channel is invalid.",
      "invalid_channel",
    );
  }
  if (installation.checkout !== paths.checkout) {
    throw new ReleaseError(
      "The lifecycle command does not own this checkout.",
      "checkout_ownership_mismatch",
    );
  }
  return { release, installation };
}

function currentStableTag(repository, allowedSigners) {
  const tags = runGit(repository, ["tag", "--points-at", "HEAD"])
    .split(/\r?\n/u)
    .filter((tag) => STABLE_TAG.test(tag));
  if (tags.length !== 1) {
    throw new ReleaseError(
      "The installed stable checkout must have exactly one SemVer tag at HEAD.",
      "installed_tag_missing",
    );
  }
  const [tag] = tags;
  const head = runGit(repository, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (verifyStableTag(repository, tag, allowedSigners) !== head) {
    throw new ReleaseError(
      "The installed stable tag does not resolve exactly to HEAD.",
      "installed_tag_mismatch",
    );
  }
  return tag;
}

export function verifyInstalledStable(repository, allowedSigners) {
  return currentStableTag(repository, allowedSigners);
}

export function discoverRelease(paths) {
  if (!paths.checkout) {
    throw new ReleaseError(
      "The installed checkout path is missing.",
      "not_installed",
    );
  }
  const { release } = installedIdentity(paths);
  const checkout = currentCheckout(paths.checkout);
  if (release.channel === "preview") {
    const branch = runGit(
      paths.checkout,
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { code: "preview_branch_invalid" },
    );
    if (branch !== "main") {
      throw new ReleaseError(
        `Preview updates require the managed main branch (found ${branch || "detached HEAD"}).`,
        "preview_branch_invalid",
      );
    }
    const line = runGit(
      paths.checkout,
      ["ls-remote", "--heads", "origin", "refs/heads/main"],
      { code: "release_discovery_failed" },
    );
    const target = line.trim().split(/\s+/u)[0] ?? "";
    if (!/^[0-9a-f]{40,64}$/u.test(target)) {
      throw new ReleaseError(
        "The origin main branch could not be resolved.",
        "release_discovery_failed",
      );
    }
    return {
      channel: "preview",
      current_revision: checkout.head,
      target_revision: target,
      current_version: "main",
      target_version: "main",
      update_available: target !== checkout.head,
      checkout_clean: checkout.clean,
      trust: "preview-unsigned",
    };
  }

  const currentTag = currentStableTag(paths.checkout, paths.allowedSigners);
  const candidates = remoteTags(paths.checkout).sort((a, b) =>
    compareStableTags(a.tag, b.tag),
  );
  const newest = candidates.at(-1);
  if (!newest || compareStableTags(newest.tag, currentTag) <= 0) {
    return {
      channel: "stable",
      current_revision: checkout.head,
      target_revision: checkout.head,
      current_version: currentTag,
      target_version: currentTag,
      update_available: false,
      checkout_clean: checkout.clean,
      trust: "verified-installed",
    };
  }
  const verifiedCommit = verifyRemoteTag(
    paths.checkout,
    newest.tag,
    paths.allowedSigners,
  );
  return {
    channel: "stable",
    current_revision: checkout.head,
    target_revision: verifiedCommit,
    current_version: currentTag,
    target_version: newest.tag,
    update_available: true,
    checkout_clean: checkout.clean,
    trust: "verified",
  };
}

export function releaseStatus(paths) {
  try {
    return { status: "ready", ...discoverRelease(paths) };
  } catch (error) {
    return {
      status: "unavailable",
      code: error instanceof ReleaseError ? error.code : "release_check_failed",
      message:
        error instanceof Error
          ? error.message
          : "Pythia could not check for updates.",
    };
  }
}
