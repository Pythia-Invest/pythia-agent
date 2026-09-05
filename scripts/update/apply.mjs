import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  copyPrivateFile,
  readJsonIfPresent,
  transactionReceipt,
  writeTransaction,
} from "../install/files.mjs";
import { serviceAction } from "../install/systemd.mjs";
import { recordInstallation, startAndVerify } from "../install/runtime.mjs";
import {
  assertCleanCheckout,
  discoverRelease,
  ReleaseError,
  runGit,
  verifyStableTag,
} from "./release.mjs";

function installedOwnership(paths, expectedHead) {
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

function fetchTarget(paths, release) {
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

function assertDescendant(paths, oldRevision, targetReference) {
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

function assertTargetCheckout(paths, release) {
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

function refreshTrustRoot(paths, release) {
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

function completeWithCandidate(paths, receipt) {
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

function failureReceipt(paths, receipt, error, services = "stopped") {
  return writeTransaction(paths, {
    ...receipt,
    phase: "failed-stopped",
    error_code: error instanceof ReleaseError ? error.code : "update_failed",
    error_message: error instanceof Error ? error.message : "Update failed.",
    services,
  });
}

export async function applyUpdate(paths, hooks = {}, resumeReceipt = null) {
  const stop = hooks.stop ?? (() => serviceAction("stop"));
  const start =
    hooks.startAndVerify ??
    (() => startAndVerify(paths, { enableAfterVerify: false }));
  const enable =
    hooks.enable ??
    (hooks.startAndVerify ? () => undefined : () => serviceAction("enable"));
  const completeCandidate =
    hooks.completeCandidate ??
    ((receipt) => completeWithCandidate(paths, receipt));
  const active = transactionReceipt(paths).value;
  if (
    !resumeReceipt &&
    active &&
    !["complete", "failed-before-stop"].includes(active.phase)
  ) {
    throw new ReleaseError(
      `Update transaction ${active.transaction_id} is incomplete at ${active.phase}. Run 'pythia recover'.`,
      "recovery_required",
    );
  }
  const before = assertCleanCheckout(paths.checkout);
  installedOwnership(paths, before.head);
  const release = resumeReceipt
    ? {
        channel: resumeReceipt.channel,
        current_revision: resumeReceipt.old_revision,
        target_revision: resumeReceipt.new_revision,
        current_version: resumeReceipt.current_version,
        target_version: resumeReceipt.target_version,
        update_available: true,
        checkout_clean: true,
        trust:
          resumeReceipt.channel === "stable" ? "verified" : "preview-unsigned",
      }
    : discoverRelease(paths);
  if (!release.update_available) return { updated: false, release };
  let targetReference;
  if (resumeReceipt) {
    if (release.channel === "stable") {
      targetReference = `refs/tags/${release.target_version}`;
      const verified = verifyStableTag(
        paths.checkout,
        release.target_version,
        paths.allowedSigners,
      );
      if (verified !== release.target_revision) {
        throw new ReleaseError(
          "The recorded stable recovery target no longer matches its verified tag.",
          "recovery_target_changed",
        );
      }
    } else {
      targetReference = release.target_revision;
      const local = runGit(paths.checkout, [
        "rev-parse",
        "--verify",
        `${release.target_revision}^{commit}`,
      ]);
      if (local !== release.target_revision) {
        throw new ReleaseError(
          "The recorded preview recovery target is unavailable locally.",
          "recovery_target_missing",
        );
      }
    }
  } else {
    targetReference = fetchTarget(paths, release);
  }
  assertDescendant(paths, before.head, targetReference);
  await hooks.beforeStop?.();
  const transaction = writeTransaction(paths, {
    ...(resumeReceipt ?? {}),
    transaction_id:
      resumeReceipt?.transaction_id ?? `update-${Date.now()}-${process.pid}`,
    operation: "update",
    channel: release.channel,
    old_revision: before.head,
    new_revision: release.target_revision,
    target_version: release.target_version,
    current_version: release.current_version,
    phase: "stopping",
    services: "stopping",
  });
  let stopAttempted = false;
  let stopConfirmed = false;
  try {
    stopAttempted = true;
    await stop();
    stopConfirmed = true;
    writeTransaction(paths, {
      ...transaction,
      phase: "stopped",
      services: "stopped",
    });
    await hooks.afterStop?.();
    const immediate = assertCleanCheckout(paths.checkout);
    if (immediate.head !== before.head) {
      throw new ReleaseError(
        "HEAD changed after update preflight.",
        "head_changed",
      );
    }
    installedOwnership(paths, before.head);
    assertDescendant(paths, before.head, targetReference);
    if (release.channel === "stable") {
      const reverified = verifyStableTag(
        paths.checkout,
        release.target_version,
        paths.allowedSigners,
      );
      if (reverified !== release.target_revision) {
        throw new ReleaseError(
          "The stable release no longer matches the verified update target.",
          "release_changed",
        );
      }
    }
    runGit(paths.checkout, [
      "-c",
      "core.hooksPath=/dev/null",
      "merge",
      "--ff-only",
      targetReference,
    ]);
    await hooks.afterMerge?.();
    assertTargetCheckout(paths, release);
    if (release.channel === "stable") {
      refreshTrustRoot(paths, release);
      assertTargetCheckout(paths, release);
    }
    writeTransaction(paths, {
      ...transaction,
      phase: "source-updated",
      services: "stopped",
    });
    await completeCandidate(transaction);
    await hooks.afterCandidate?.();
    assertTargetCheckout(paths, release);
    writeTransaction(paths, {
      ...transaction,
      phase: "prepared",
      services: "stopped",
    });
    await hooks.beforeStart?.();
    assertTargetCheckout(paths, release);
    await start();
    await hooks.afterStart?.();
    assertTargetCheckout(paths, release);
    recordInstallation(paths, release.channel, release.target_revision);
    writeTransaction(paths, {
      ...transaction,
      phase: "complete",
      services: "running",
      error_code: null,
      error_message: null,
    });
    await enable();
    return { updated: true, release };
  } catch (error) {
    if (stopAttempted) {
      try {
        await stop();
        stopConfirmed = true;
      } catch {
        // The receipt must report that stopped state could not be confirmed.
      }
      failureReceipt(
        paths,
        transaction,
        error,
        stopConfirmed ? "stopped" : "stop-unconfirmed",
      );
    }
    throw error;
  }
}

export async function recoverUpdate(paths, hooks = {}) {
  const receipt = transactionReceipt(paths).value;
  if (!receipt || receipt.operation !== "update") {
    throw new ReleaseError(
      "There is no update transaction to recover.",
      "no_recovery",
    );
  }
  const stop = hooks.stop ?? (() => serviceAction("stop"));
  if (receipt.phase === "complete") {
    try {
      await stop();
      const checkout = assertCleanCheckout(paths.checkout);
      installedOwnership(paths, checkout.head);
      if (checkout.head !== receipt.new_revision) {
        throw new ReleaseError(
          "The completed update receipt no longer matches the installed checkout.",
          "recovery_revision_mismatch",
        );
      }
      const resumeReady =
        hooks.startAndVerify ??
        (() => startAndVerify(paths, { enableAfterVerify: false }));
      const enable =
        hooks.enable ??
        (hooks.startAndVerify
          ? () => undefined
          : () => serviceAction("enable"));
      await resumeReady();
      await enable();
      return { recovered: true, receipt };
    } catch (error) {
      let stopConfirmed = false;
      try {
        await stop();
        stopConfirmed = true;
      } catch {
        // The failure receipt retains the unconfirmed state.
      }
      failureReceipt(
        paths,
        receipt,
        error,
        stopConfirmed ? "stopped" : "stop-unconfirmed",
      );
      throw error;
    }
  }
  try {
    await stop();
  } catch (error) {
    failureReceipt(paths, receipt, error, "stop-unconfirmed");
    throw error;
  }
  const checkout = assertCleanCheckout(paths.checkout);
  if (checkout.head === receipt.old_revision) {
    return applyUpdate(paths, hooks, receipt);
  }
  if (checkout.head !== receipt.new_revision) {
    throw new ReleaseError(
      "The checkout matches neither revision in the recovery receipt. Manual inspection is required.",
      "recovery_revision_mismatch",
    );
  }
  const release = {
    channel: receipt.channel,
    current_revision: receipt.old_revision,
    target_revision: receipt.new_revision,
    current_version: receipt.current_version,
    target_version: receipt.target_version,
  };
  const completeCandidate =
    hooks.completeCandidate ??
    ((current) => completeWithCandidate(paths, current));
  const start =
    hooks.startAndVerify ??
    (() => startAndVerify(paths, { enableAfterVerify: false }));
  const enable =
    hooks.enable ??
    (hooks.startAndVerify ? () => undefined : () => serviceAction("enable"));
  assertTargetCheckout(paths, release);
  if (release.channel === "stable") {
    refreshTrustRoot(paths, release);
    assertTargetCheckout(paths, release);
  }
  await completeCandidate(receipt);
  await hooks.afterCandidate?.();
  assertTargetCheckout(paths, release);
  try {
    await hooks.beforeStart?.();
    assertTargetCheckout(paths, release);
    await start();
    await hooks.afterStart?.();
    assertTargetCheckout(paths, release);
    recordInstallation(paths, release.channel, release.target_revision);
    const complete = writeTransaction(paths, {
      ...receipt,
      phase: "complete",
      services: "running",
      error_code: null,
      error_message: null,
    });
    await enable();
    return { recovered: true, receipt: complete };
  } catch (error) {
    let stopConfirmed = false;
    try {
      await stop();
      stopConfirmed = true;
    } catch {
      // It is already safe for recovery if the target was not running.
    }
    failureReceipt(
      paths,
      receipt,
      error,
      stopConfirmed ? "stopped" : "stop-unconfirmed",
    );
    throw error;
  }
}
