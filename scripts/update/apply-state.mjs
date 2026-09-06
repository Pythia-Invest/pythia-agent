import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  copyPrivateFile,
  readJsonIfPresent,
  writeTransaction,
} from "../install/files.mjs";
import {
  assertCleanCheckout,
  ReleaseError,
  runGit,
  verifyStableTag,
} from "./release.mjs";

export function installedOwnership(paths, expectedHead) {
  const installation = readJsonIfPresent(paths.installFile);
  const release = readJsonIfPresent(paths.releaseFile);
  if (
    !installation ||
    !release ||
    installation.checkout !== paths.checkout ||
    installation.revision !== expectedHead ||
    installation.source?.update_safe === false
  ) {
    throw new ReleaseError(
      "Installation ownership changed or the explicitly activated source is not update-safe. Reconcile to a clean main checkout and run 'pythia rebuild' before updating.",
      "ownership_changed",
    );
  }
  return { installation, release };
}

export function fetchTarget(paths, release) {
  if (release.channel === "stable") {
    const reference = `refs/tags/${release.target_version}`;
    runGit(paths.checkout, [
      "-c",
      "core.hooksPath=/dev/null",
      "fetch",
      "--no-tags",
      "origin",
      `${reference}:${reference}`,
    ]);
    const commit = verifyStableTag(
      paths.checkout,
      release.target_version,
      paths.allowedSigners,
    );
    if (commit !== release.target_revision) {
      throw new ReleaseError(
        "The stable release changed after discovery.",
        "release_changed",
      );
    }
    return reference;
  }
  runGit(paths.checkout, [
    "-c",
    "core.hooksPath=/dev/null",
    "fetch",
    "--no-tags",
    "origin",
    "refs/heads/main:refs/remotes/origin/main",
  ]);
  const commit = runGit(paths.checkout, [
    "rev-parse",
    "--verify",
    "refs/remotes/origin/main^{commit}",
  ]);
  if (commit !== release.target_revision) {
    throw new ReleaseError(
      "The preview main branch changed after discovery. Check again before updating.",
      "release_changed",
    );
  }
  return "refs/remotes/origin/main";
}

export function assertDescendant(paths, oldRevision, targetReference) {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", oldRevision, targetReference],
    { cwd: paths.checkout, stdio: "ignore" },
  );
  if (result.status !== 0) {
    throw new ReleaseError(
      "The selected release is not a fast-forward descendant. Pythia will not merge, rebase, reset, or overwrite the checkout.",
      "release_diverged",
    );
  }
}

export function assertTargetCheckout(paths, release) {
  const checkout = assertCleanCheckout(paths.checkout);
  if (checkout.head !== release.target_revision) {
    throw new ReleaseError(
      "The checkout does not exactly match the verified update target.",
      "target_checkout_changed",
    );
  }
  if (release.channel === "stable") {
    const verified = verifyStableTag(
      paths.checkout,
      release.target_version,
      paths.allowedSigners,
    );
    if (verified !== checkout.head) {
      throw new ReleaseError(
        "The stable checkout no longer matches its verified release tag.",
        "release_changed",
      );
    }
  }
  return checkout;
}

export function refreshTrustRoot(paths, release) {
  const candidate = join(paths.checkout, "release", "allowed_signers");
  if (!existsSync(candidate)) {
    throw new ReleaseError(
      "The verified release does not contain its release trust file.",
      "candidate_trust_missing",
    );
  }
  const verified = verifyStableTag(
    paths.checkout,
    release.target_version,
    candidate,
  );
  if (verified !== release.target_revision) {
    throw new ReleaseError(
      "The candidate trust root does not retain the signer of this already verified release.",
      "candidate_trust_invalid",
    );
  }
  copyPrivateFile(candidate, paths.allowedSigners);
}

export function completeWithCandidate(paths, receipt) {
  const node = join(paths.runtimeRoot, "node", "22.16.0", "bin", "node");
  const cli = join(paths.checkout, "scripts", "install", "cli.mjs");
  const result = spawnSync(
    node,
    [cli, "complete-update", "--transaction", receipt.transaction_id],
    {
      cwd: paths.checkout,
      encoding: "utf8",
      env: { ...process.env, PYTHIA_CHECKOUT: paths.checkout },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1_200_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `Release preparation failed${detail ? `:\n${detail}` : ""}`,
    );
  }
}

export function failureReceipt(paths, receipt, error, services = "stopped") {
  return writeTransaction(paths, {
    ...receipt,
    phase: "failed-stopped",
    error_code: error instanceof ReleaseError ? error.code : "update_failed",
    error_message: error instanceof Error ? error.message : "Update failed.",
    services,
  });
}
