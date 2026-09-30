import { transactionReceipt, writeTransaction } from "../install/files.mjs";
import { serviceAction } from "../install/systemd.mjs";
import { recordInstallation, startAndVerify } from "../install/runtime.mjs";
import {
  assertCleanCheckout,
  discoverRelease,
  ReleaseError,
  runGit,
  verifyStableTag,
} from "./release.mjs";
import {
  assertDescendant,
  assertTargetCheckout,
  completeWithCandidate,
  failureReceipt,
  fetchTarget,
  installedOwnership,
  refreshTrustRoot,
} from "./apply-state.mjs";

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
