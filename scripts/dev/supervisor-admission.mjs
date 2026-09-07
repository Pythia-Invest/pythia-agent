import { existsSync, rmSync } from "node:fs";
import { createJsonExclusive, readJson } from "./files.mjs";
import { identityMatches, processIdentity } from "./processes.mjs";
import {
  bootstrapRuntime,
  recoverInterruptedProfileInitialization,
} from "./runtime.mjs";

export function validateReceipt(paths, receipt) {
  if (
    receipt.schema_version !== 1 ||
    receipt.stack !== paths.id ||
    receipt.repository !== paths.repositoryRoot ||
    receipt.hermes_root !== paths.hermesRoot ||
    receipt.state_root !== paths.stateRoot
  ) {
    throw new Error(
      `Refusing receipt that does not belong to the current worktree stack: ${paths.receipt}`,
    );
  }
  return receipt;
}

export function lifecycleRequestRecord(
  paths,
  supervisor,
  operation,
  generation,
) {
  return {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    state_root: paths.stateRoot,
    supervisor,
    operation,
    generation,
  };
}

export function validateLifecycleRequest(
  paths,
  request,
  supervisor,
  operation,
  generation,
) {
  if (
    request.schema_version !== 1 ||
    request.stack !== paths.id ||
    request.repository !== paths.repositoryRoot ||
    request.state_root !== paths.stateRoot ||
    request.operation !== operation ||
    request.generation !== generation ||
    request.supervisor?.pid !== supervisor.pid ||
    request.supervisor?.started !== supervisor.started ||
    request.supervisor?.command_sha256 !== supervisor.command_sha256
  ) {
    throw new Error(
      operation === "restart-hermes"
        ? "Refusing a stale or foreign Hermes restart request for this worktree."
        : "Refusing a stale, foreign, or conflicting managed runtime refresh request for this worktree.",
    );
  }
  return request;
}

function validatePreparationAdmission(paths, admission) {
  if (
    admission.schema_version !== 1 ||
    admission.stack !== paths.id ||
    admission.repository !== paths.repositoryRoot ||
    admission.state_root !== paths.stateRoot ||
    typeof admission.operation !== "string" ||
    admission.operation.length === 0 ||
    !Number.isSafeInteger(admission.owner?.pid) ||
    admission.owner.pid <= 1 ||
    typeof admission.owner.started !== "string" ||
    !/^[a-f0-9]{64}$/u.test(admission.owner.command_sha256)
  ) {
    throw new Error(
      `Refusing a preparation admission that does not belong to this worktree: ${paths.preparationAdmission}`,
    );
  }
  return admission;
}

export function acquirePreparationAdmission(paths, operation) {
  const owner = processIdentity(process.pid);
  if (!owner) {
    throw new Error("Could not establish preparation owner identity.");
  }
  const admission = {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    state_root: paths.stateRoot,
    operation,
    owner,
  };
  if (!createJsonExclusive(paths.preparationAdmission, admission)) {
    const current = validatePreparationAdmission(
      paths,
      readJson(paths.preparationAdmission),
    );
    const state = identityMatches(current.owner) ? "live" : "stale";
    const recovery =
      state === "live"
        ? "Wait for that operation to finish."
        : `After proving no preparation is active, remove only the exact stale admission ${paths.preparationAdmission}.`;
    throw new Error(
      `Refusing ${operation}: a ${state} preparation owner already exists at ${paths.preparationAdmission}. It is never adopted or removed automatically. ${recovery}`,
    );
  }

  let released = false;
  const assertOwned = () => {
    if (released) return;
    const current = validatePreparationAdmission(
      paths,
      readJson(paths.preparationAdmission),
    );
    if (
      current.operation !== operation ||
      current.owner.pid !== owner.pid ||
      current.owner.started !== owner.started ||
      current.owner.command_sha256 !== owner.command_sha256
    ) {
      throw new Error(
        "Refusing to release a preparation admission owned by another process.",
      );
    }
  };
  const release = () => {
    if (released) return;
    assertOwned();
    rmSync(paths.preparationAdmission);
    released = true;
  };

  try {
    if (existsSync(paths.receipt)) {
      const receipt = validateReceipt(paths, readJson(paths.receipt));
      const state = identityMatches(receipt.supervisor) ? "live" : "stale";
      throw new Error(
        `Refusing ${operation}: a ${state} foreground owner already exists at ${paths.receipt}. Runtime preparation must be requested through the foreground refresh owner.`,
      );
    }
  } catch (error) {
    release();
    throw error;
  }
  return { assertOwned, release };
}

export async function withPreparationAdmission(paths, operation, action) {
  const admission = acquirePreparationAdmission(paths, operation);
  try {
    return await action();
  } finally {
    admission.release();
  }
}

export function initializeDevelopmentRuntime(paths, options = {}) {
  return withPreparationAdmission(paths, "development initialization", () =>
    (options.prepareRuntime ?? bootstrapRuntime)(paths),
  );
}

export function recoverDevelopmentInitialization(paths) {
  return withPreparationAdmission(paths, "initialization recovery", () =>
    recoverInterruptedProfileInitialization(paths),
  );
}
