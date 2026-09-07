import { existsSync } from "node:fs";
import { createJsonExclusive, readJson } from "./files.mjs";
import { identityMatches, signalOwned } from "./processes.mjs";
import { bootstrapRuntime } from "./runtime.mjs";
import {
  lifecycleRequestRecord,
  validateLifecycleRequest,
  withPreparationAdmission,
} from "./supervisor-admission.mjs";
import { validateReceipt } from "./supervisor-admission.mjs";

export async function requestHermesRestart(paths, timeoutMs = 90_000) {
  if (!existsSync(paths.receipt)) {
    throw new Error("The current worktree development stack is not running.");
  }
  const receipt = validateReceipt(paths, readJson(paths.receipt));
  if (!identityMatches(receipt.supervisor)) {
    throw new Error(
      "Refusing Hermes restart: the foreground supervisor receipt is stale or foreign.",
    );
  }
  if (!Number.isSafeInteger(receipt.hermes_generation)) {
    throw new Error(
      "Refusing Hermes restart: the live supervisor does not support generation acknowledgements.",
    );
  }
  if (typeof receipt.hermes_restarting !== "boolean") {
    throw new Error(
      "Refusing Hermes restart: the live supervisor does not expose restart state.",
    );
  }
  if (receipt.runtime_refreshing) {
    throw new Error(
      "Refusing Hermes restart while a managed runtime refresh is in progress.",
    );
  }
  let joinedExistingRequest = false;
  if (existsSync(paths.hermesRestartRequest)) {
    validateLifecycleRequest(
      paths,
      readJson(paths.hermesRestartRequest),
      receipt.supervisor,
      "restart-hermes",
      receipt.hermes_generation,
    );
    joinedExistingRequest = true;
  }
  const hermes = receipt.children.find((child) => child.name === "hermes");
  if (
    !receipt.hermes_restarting &&
    !joinedExistingRequest &&
    (!hermes || !identityMatches(hermes))
  ) {
    throw new Error(
      "Refusing Hermes restart: the receipt-owned Hermes process is stale or foreign.",
    );
  }
  const previousGeneration = receipt.hermes_generation;
  if (!receipt.hermes_restarting && !joinedExistingRequest) {
    const created = createJsonExclusive(
      paths.hermesRestartRequest,
      lifecycleRequestRecord(
        paths,
        receipt.supervisor,
        "restart-hermes",
        previousGeneration,
      ),
    );
    if (!created) {
      validateLifecycleRequest(
        paths,
        readJson(paths.hermesRestartRequest),
        receipt.supervisor,
        "restart-hermes",
        previousGeneration,
      );
    } else {
      await signalOwned(receipt.supervisor, "SIGUSR1");
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!existsSync(paths.receipt)) {
      throw new Error(
        "Hermes restart failed because the foreground supervisor stopped.",
      );
    }
    const current = validateReceipt(paths, readJson(paths.receipt));
    if (!identityMatches(current.supervisor)) {
      throw new Error(
        "Hermes restart failed because the foreground supervisor identity changed.",
      );
    }
    if (current.hermes_generation > previousGeneration) {
      const restarted = current.children.find(
        (child) => child.name === "hermes",
      );
      if (!restarted || !identityMatches(restarted)) {
        throw new Error(
          "Hermes restart acknowledgement has no live receipt-owned Hermes process.",
        );
      }
      return {
        restarted: true,
        generation: current.hermes_generation,
      };
    }
  }
  throw new Error(
    `Hermes did not acknowledge a healthy restart within ${timeoutMs}ms.`,
  );
}

export async function requestRuntimeRefresh(
  paths,
  timeoutMs = 180_000,
  options = {},
) {
  if (!existsSync(paths.receipt)) {
    await withPreparationAdmission(paths, "stopped runtime refresh", () =>
      (options.prepareRuntime ?? bootstrapRuntime)(paths),
    );
    return { refreshed: true, running: false };
  }
  const receipt = validateReceipt(paths, readJson(paths.receipt));
  if (!identityMatches(receipt.supervisor)) {
    throw new Error(
      "Refusing runtime refresh: the foreground supervisor receipt is stale or foreign.",
    );
  }
  if (
    !Number.isSafeInteger(receipt.runtime_generation) ||
    typeof receipt.runtime_refreshing !== "boolean"
  ) {
    throw new Error(
      "Refusing runtime refresh: the live supervisor does not support refresh acknowledgements.",
    );
  }
  if (receipt.hermes_restarting) {
    throw new Error(
      "Refusing runtime refresh while a Hermes settings restart is in progress.",
    );
  }
  const previousGeneration = receipt.runtime_generation;
  let joinedExistingRequest = false;
  if (existsSync(paths.hermesRestartRequest)) {
    validateLifecycleRequest(
      paths,
      readJson(paths.hermesRestartRequest),
      receipt.supervisor,
      "refresh-runtime",
      previousGeneration,
    );
    joinedExistingRequest = true;
  }
  if (!receipt.runtime_refreshing && !joinedExistingRequest) {
    for (const child of receipt.children) {
      if (!identityMatches(child)) {
        throw new Error(
          `Refusing runtime refresh: receipt-owned ${child.name} is stale or foreign.`,
        );
      }
    }
    const created = createJsonExclusive(
      paths.hermesRestartRequest,
      lifecycleRequestRecord(
        paths,
        receipt.supervisor,
        "refresh-runtime",
        previousGeneration,
      ),
    );
    if (!created) {
      validateLifecycleRequest(
        paths,
        readJson(paths.hermesRestartRequest),
        receipt.supervisor,
        "refresh-runtime",
        previousGeneration,
      );
    } else {
      await signalOwned(receipt.supervisor, "SIGUSR1");
    }
  }

  const expectedServices = receipt.children.map((child) => child.name);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!existsSync(paths.receipt)) {
      throw new Error(
        "Runtime refresh failed because the foreground supervisor stopped.",
      );
    }
    const current = validateReceipt(paths, readJson(paths.receipt));
    if (!identityMatches(current.supervisor)) {
      throw new Error(
        "Runtime refresh failed because the foreground supervisor identity changed.",
      );
    }
    if (current.runtime_generation > previousGeneration) {
      for (const name of expectedServices) {
        const replacement = current.children.find(
          (child) => child.name === name,
        );
        if (!replacement || !identityMatches(replacement)) {
          throw new Error(
            `Runtime refresh acknowledgement has no live receipt-owned ${name} process.`,
          );
        }
      }
      return {
        refreshed: true,
        running: true,
        generation: current.runtime_generation,
      };
    }
  }
  throw new Error(
    `Managed runtime did not acknowledge a healthy refresh within ${timeoutMs}ms.`,
  );
}
