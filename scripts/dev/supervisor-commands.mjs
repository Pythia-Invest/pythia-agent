import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./files.mjs";
import {
  identityMatches,
  processProvablyGone,
  signalOwned,
} from "./processes.mjs";
import { secrets } from "./runtime-config.mjs";
import { bootstrapRuntime } from "./runtime.mjs";
import {
  acquirePreparationAdmission,
  retireDeadReceipt,
  validateReceipt,
} from "./supervisor-admission.mjs";
import {
  deskReady,
  developmentServices,
  hermesReady,
  hermesSettingsReady,
} from "./supervisor-services.mjs";
import {
  terminateChildren,
  waitForPortsRelease,
} from "./supervisor-processes.mjs";
import { supervise } from "./supervisor-run.mjs";

export async function runDevelopment(paths, options = {}) {
  const admission = acquirePreparationAdmission(
    paths,
    "foreground development startup",
  );
  let admitted = false;
  const releaseAdmission = () => {
    if (admitted) return;
    admission.release();
    admitted = true;
  };
  try {
    const { environment } = await (options.prepareRuntime ?? bootstrapRuntime)(
      paths,
      { allowStagedTransition: true },
    );
    console.log(`Starting ${paths.id} (${paths.profile})`);
    console.log(`Desk:         http://127.0.0.1:${paths.ports.desk}`);
    console.log(`Hermes API:   http://127.0.0.1:${paths.ports.hermes}`);
    console.log(`Settings:     http://127.0.0.1:${paths.ports.settings}`);
    const services = developmentServices(
      paths,
      environment,
      secrets(paths).hermes_settings_token,
    );
    for (const service of services) {
      if (service.name === "hermes")
        service.ready = (child) => hermesReady(paths, child);
      if (service.name === "hermes-settings")
        service.ready = (child) => hermesSettingsReady(paths, child);
      if (service.name === "desk")
        service.ready = (child) => deskReady(paths, child);
    }
    return await (options.supervise ?? supervise)(paths, services, {
      async refreshRuntime() {
        await bootstrapRuntime(paths);
      },
      onReceiptOwned: releaseAdmission,
      onReady() {
        console.log(
          "Pythia development stack is ready. Press Ctrl-C to stop it.",
        );
      },
    });
  } finally {
    releaseAdmission();
  }
}

export function stackStatus(paths) {
  if (!existsSync(paths.receipt)) {
    return { stack: paths.id, status: "stopped", ports: paths.ports };
  }
  const receipt = validateReceipt(paths, readJson(paths.receipt));
  return {
    stack: paths.id,
    profile: paths.profile,
    status: identityMatches(receipt.supervisor) ? "running" : "stale",
    hermes_generation: receipt.hermes_generation,
    hermes_restarting: receipt.hermes_restarting,
    runtime_generation: receipt.runtime_generation,
    runtime_refreshing: receipt.runtime_refreshing,
    ports: {
      hermes: paths.ports.hermes,
      settings: paths.ports.settings,
      desk: paths.ports.desk,
    },
    services: receipt.children.map((child) => ({
      name: child.name,
      status: identityMatches(child) ? "running" : "stale",
      pid: child.pid,
    })),
  };
}

export async function stopStack(paths) {
  if (!existsSync(paths.receipt)) {
    return { stopped: false, reason: "already-stopped" };
  }
  const retired = retireDeadReceipt(paths);
  if (retired) return { stopped: false, reason: "already-exited", retired };
  const receipt = validateReceipt(paths, readJson(paths.receipt));
  if (processProvablyGone(receipt.supervisor)) {
    return stopOrphanedChildren(paths, receipt);
  }
  await signalOwned(receipt.supervisor, "SIGTERM");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && existsSync(paths.receipt)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (existsSync(paths.receipt)) {
    throw new Error(
      `Owned development supervisor PID ${receipt.supervisor.pid} did not stop; refusing a broad or unverified kill.`,
    );
  }
  return { stopped: true };
}

/**
 * The supervisor is gone but a recorded child may still hold its port. Stops
 * only children whose live identity matches the receipt exactly; a recorded
 * PID that is free or reused by another process is left alone. The receipt is
 * set aside only after the processes and this stack's ports are proven gone.
 */
async function stopOrphanedChildren(paths, receipt) {
  const orphans = receipt.children.filter(identityMatches);
  await terminateChildren(
    orphans.map(({ name, ...identity }) => ({ name, identity })),
  );
  await waitForPortsRelease(paths.ports, 7_000, 1_500);
  const retired = retireDeadReceipt(paths);
  if (!retired) {
    throw new Error(
      `Development receipt ${paths.receipt} still names a running process after its orphaned children were stopped; leaving it in place.`,
    );
  }
  return {
    stopped: true,
    reason: "supervisor-exited",
    terminated: orphans.map(({ name, pid }) => ({ name, pid })),
    retired,
  };
}

export function resetDerivedDevelopmentState(paths) {
  retireDeadReceipt(paths);
  if (existsSync(paths.receipt)) {
    const receipt = validateReceipt(paths, readJson(paths.receipt));
    const state = identityMatches(receipt.supervisor) ? "running" : "stale";
    throw new Error(
      `Refusing reset while a ${state} receipt exists at ${paths.receipt}. Pythia never deletes around an unverified process.`,
    );
  }
  const admission = acquirePreparationAdmission(paths, "derived-state reset");
  let processRootMoved = false;
  let quarantine;
  try {
    for (const target of [paths.testRoot, paths.cacheRoot]) {
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    }
    quarantine = mkdtempSync(join(paths.stateRoot, ".process-reset-"));
    admission.assertOwned();
    renameSync(paths.processRoot, join(quarantine, "processes"));
    processRootMoved = true;
    rmSync(quarantine, { recursive: true, force: true });
  } finally {
    if (!processRootMoved) admission.release();
    else if (quarantine && existsSync(quarantine)) {
      rmSync(quarantine, { recursive: true, force: true });
    }
  }
  return {
    reset: [paths.processRoot, paths.testRoot, paths.cacheRoot],
    preserved: [
      paths.hermesRoot,
      paths.basicMemoryConfig,
      paths.workspace,
      paths.knowledge,
      paths.profileInitialization,
      paths.runtimeReceipt,
    ],
  };
}
