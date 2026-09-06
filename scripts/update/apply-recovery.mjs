import { transactionReceipt, writeTransaction } from "../install/files.mjs";
import { serviceAction } from "../install/systemd.mjs";
import { recordInstallation, startAndVerify } from "../install/runtime.mjs";
import { assertCleanCheckout, ReleaseError } from "./release.mjs";
import { applyUpdate } from "./apply-operation.mjs";
import {
  assertTargetCheckout,
  completeWithCandidate,
  failureReceipt,
  installedOwnership,
  refreshTrustRoot,
} from "./apply-state.mjs";

export async function recoverUpdate(paths, hooks = {}) {
  const receipt = transactionReceipt(paths).value;
  if (receipt?.operation !== "update") {
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
