import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./files.mjs";
import { identityMatches, signalOwned } from "./processes.mjs";
import { bootstrapRuntime } from "./runtime.mjs";
import {
  acquirePreparationAdmission,
  validateReceipt,
} from "./supervisor-admission.mjs";
import {
  basicMemoryReady,
  deskReady,
  developmentServices,
  hermesReady,
} from "./supervisor-services.mjs";
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
    if (
      !existsSync(join(paths.repositoryRoot, "apps", "desk", "package.json"))
    ) {
      throw new Error(
        "@pythia/desk is not present yet. The T06 supervisor seam is ready; land T07 before running the assembled stack.",
      );
    }
    const { environment } = await (options.prepareRuntime ?? bootstrapRuntime)(
      paths,
    );
    console.log(`Starting ${paths.id} (${paths.profile})`);
    console.log(`Desk:         http://127.0.0.1:${paths.ports.desk}`);
    console.log(`Hermes API:   http://127.0.0.1:${paths.ports.hermes}`);
    console.log(`Basic Memory: http://127.0.0.1:${paths.ports.memory}/mcp`);
    const services = developmentServices(paths, environment);
    services[0].ready = (child) => hermesReady(paths, child);
    services[1].ready = (child) =>
      basicMemoryReady(paths, child, services[1].environment);
    services[2].ready = (child) => deskReady(paths, child);
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
    ports: paths.ports,
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
  const receipt = validateReceipt(paths, readJson(paths.receipt));
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

export function resetDerivedDevelopmentState(paths) {
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
