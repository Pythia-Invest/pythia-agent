import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson, createJsonExclusive, readJson } from "./files.mjs";
import { verifyBasicMemoryReadiness } from "../install/basic-memory-readiness.mjs";
import {
  assertPortsFree,
  identityMatches,
  processIdentity,
  signalOwned,
} from "./processes.mjs";
import {
  bootstrapRuntime,
  recoverInterruptedProfileInitialization,
  runtimeCommands,
} from "./runtime.mjs";

const serviceOwnerPath = fileURLToPath(
  new URL("./service-owner.mjs", import.meta.url),
);

async function waitForIdentity(pid) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const identity = processIdentity(pid);
    if (identity) return identity;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Could not establish process identity for PID ${pid}.`);
}

async function spawnOwnedService(service, stdio) {
  const child = spawn(
    process.execPath,
    [serviceOwnerPath, service.command, ...service.args],
    {
      cwd: service.cwd,
      env: service.environment,
      stdio,
      detached: true,
    },
  );
  child.once("error", () => {});
  const owned = {
    name: service.name,
    port: service.port,
    child,
    identity: await waitForIdentity(child.pid),
  };
  owned.exit = exitOutcome(owned);
  return owned;
}

async function fetchReady(url, init, label, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not listening";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${label} exited before readiness (${child.signalCode ?? `exit ${child.exitCode}`}).`,
      );
    }
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.cause?.code ?? error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready at ${url}: ${last}.`);
}

async function hermesHealth(paths, child, timeoutMs = 45_000) {
  const response = await fetchReady(
    `http://127.0.0.1:${paths.ports.hermes}/health`,
    {},
    "Hermes API server",
    child,
    timeoutMs,
  );
  const body = await response.json().catch(() => ({}));
  if (body.status !== "ok") {
    throw new Error("Hermes health endpoint returned an unexpected response.");
  }
}

async function waitForChildIdentityStability(child, stabilityMs) {
  const identity = processIdentity(child.pid);
  if (!identity) {
    throw new Error("Hermes wrapper exited before stability verification.");
  }
  const deadline = Date.now() + stabilityMs;
  while (Date.now() < deadline) {
    if (
      child.exitCode !== null ||
      child.signalCode !== null ||
      !identityMatches(identity)
    ) {
      throw new Error(
        "Hermes wrapper exited after initial health but before stable readiness.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function hermesReady(paths, child) {
  await hermesHealth(paths, child);
  await waitForChildIdentityStability(child, 1_000);
  await hermesHealth(paths, child, 5_000);
}

export async function basicMemoryReady(paths, child, environment) {
  return verifyBasicMemoryReadiness(paths, {
    child,
    environment,
    executable: runtimeCommands(paths).basicMemory,
  });
}

export async function deskReady(paths, child) {
  await fetchReady(
    `http://127.0.0.1:${paths.ports.desk}/`,
    {},
    "Pythia Desk",
    child,
    60_000,
  );
}

export function developmentServices(paths, environment) {
  const commands = runtimeCommands(paths);
  const basicMemoryEnvironment = { ...environment };
  delete basicMemoryEnvironment.API_SERVER_KEY;
  return [
    {
      name: "hermes",
      port: paths.ports.hermes,
      command: commands.hermes,
      args: commands.hermesGateway,
      cwd: paths.workspace,
      environment,
      ready: () => undefined,
    },
    {
      name: "basic-memory",
      port: paths.ports.memory,
      command: commands.basicMemory,
      args: commands.basicMemoryMcp,
      cwd: paths.repositoryRoot,
      environment: basicMemoryEnvironment,
      ready: () => undefined,
    },
    {
      name: "desk",
      port: paths.ports.desk,
      command: "pnpm",
      args: commands.desk,
      cwd: paths.repositoryRoot,
      environment,
      ready: () => undefined,
    },
  ];
}

async function terminateChildren(children) {
  const targeted = [];
  for (const item of children) {
    if (!processGroupExists(item.identity.pid)) continue;
    const currentLeader = processIdentity(item.identity.pid);
    if (currentLeader && !identityMatches(item.identity)) {
      throw new Error(
        `Refusing to signal ${item.name} process group ${item.identity.pid}: its leader identity is foreign.`,
      );
    }
    signalProcessGroup(item.identity.pid, "SIGTERM");
    targeted.push(item);
  }
  await Promise.all(
    targeted.map((item) => waitForProcessGroupExit(item.identity.pid, 8_000)),
  );
  for (const item of targeted) {
    if (processGroupExists(item.identity.pid)) {
      signalProcessGroup(item.identity.pid, "SIGKILL");
    }
  }
  const stopped = await Promise.all(
    targeted.map((item) => waitForProcessGroupExit(item.identity.pid, 2_000)),
  );
  const resistant = targeted.filter((_item, index) => !stopped[index]);
  if (resistant.length > 0) {
    throw new Error(
      `Receipt-owned process groups did not stop: ${resistant.map((item) => `${item.name} (${item.identity.pid})`).join(", ")}.`,
    );
  }
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true;
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(processGroupId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processGroupExists(processGroupId);
}

async function waitForPortsRelease(ports, timeoutMs, quietMs = 0) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let freeSince;
  while (Date.now() < deadline) {
    try {
      await assertPortsFree(ports);
      freeSince ??= Date.now();
      if (Date.now() - freeSince >= quietMs) return;
    } catch (error) {
      lastError = error;
      freeSince = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const detail = lastError?.message ?? "the required quiet window was not met";
  throw new Error(
    `Receipt-owned service stopped but its listener was not continuously free within ${timeoutMs}ms; refusing to start a replacement. ${detail}`,
  );
}

const noReuseAddressBindProbe = `
import socket
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
timeout = float(sys.argv[3])
quiet = float(sys.argv[4])
interval = float(sys.argv[5])
deadline = time.monotonic() + timeout
free_since = None

while time.monotonic() < deadline:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
    try:
        sock.bind((host, port))
        if free_since is None:
            free_since = time.monotonic()
        if time.monotonic() - free_since >= quiet:
            raise SystemExit(0)
    except OSError:
        free_since = None
    finally:
        sock.close()
    time.sleep(interval)

raise SystemExit(75)
`;

export async function waitForNoReuseAddressPortRelease({
  python,
  host,
  port,
  timeoutMs,
  quietMs,
  intervalMs = 150,
  signal,
}) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [
        "-c",
        noReuseAddressBindProbe,
        host,
        String(port),
        String(timeoutMs / 1_000),
        String(quietMs / 1_000),
        String(intervalMs / 1_000),
      ],
      { stdio: "ignore" },
    );
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(new Error("Hermes port-release wait cancelled while stopping."));
    };
    const watchdog = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        new Error(
          `Hermes port-release probe exceeded its ${timeoutMs}ms bound.`,
        ),
      );
    }, timeoutMs + 5_000);
    child.once("error", (error) => {
      finish(
        new Error(
          `Hermes port-release probe could not run the pinned Python interpreter ${python}: ${error.message}`,
        ),
      );
    });
    child.once("exit", (code, childSignal) => {
      if (code === 0) {
        finish();
      } else if (code === 75) {
        finish(
          new Error(
            `Hermes port ${host}:${port} was not continuously free under native no-reuse-address semantics within ${timeoutMs}ms; refusing to start a replacement.`,
          ),
        );
      } else {
        finish(
          new Error(
            `Hermes port-release probe exited unexpectedly (${childSignal ?? `exit ${code}`}).`,
          ),
        );
      }
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForHermesPortRelease(paths, options = {}) {
  return waitForNoReuseAddressPortRelease({
    python: join(paths.managedPython, ".venv", "bin", "python"),
    host: "127.0.0.1",
    port: paths.ports.hermes,
    timeoutMs: 75_000,
    quietMs: 1_500,
    signal: options.signal,
  });
}

async function terminateOwnedService(item, releaseProof) {
  if (item.child.exitCode !== null || item.child.signalCode !== null) {
    throw new Error(
      `Cannot restart ${item.name}: its receipt-owned process already exited.`,
    );
  }
  if (!identityMatches(item.identity)) {
    throw new Error(
      `Cannot restart ${item.name}: its process identity is stale or foreign.`,
    );
  }
  signalProcessGroup(item.identity.pid, "SIGTERM");
  const groupExited = await waitForProcessGroupExit(item.identity.pid, 8_000);
  if (!groupExited) {
    signalProcessGroup(item.identity.pid, "SIGKILL");
    await waitForProcessGroupExit(item.identity.pid, 2_000);
  }
  if (processGroupExists(item.identity.pid)) {
    throw new Error(
      `Receipt-owned ${item.name} process group did not stop cleanly.`,
    );
  }
  if (releaseProof) await releaseProof();
}

function exitOutcome(item) {
  if (item.child.exitCode !== null || item.child.signalCode !== null) {
    return Promise.resolve({
      kind: "exit",
      name: item.name,
      code: item.child.exitCode,
      signal: item.child.signalCode,
    });
  }
  return new Promise((resolve) => {
    item.child.once("exit", (code, signal) =>
      resolve({ kind: "exit", name: item.name, code, signal }),
    );
  });
}

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

function lifecycleRequestRecord(paths, supervisor, operation, generation) {
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

function validateLifecycleRequest(
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

function acquirePreparationAdmission(paths, operation) {
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

async function withPreparationAdmission(paths, operation, action) {
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

export async function supervise(paths, services, options = {}) {
  if (existsSync(paths.receipt)) {
    const receipt = validateReceipt(paths, readJson(paths.receipt));
    const state = identityMatches(receipt.supervisor) ? "running" : "stale";
    throw new Error(
      `Development receipt already exists (${state}) at ${paths.receipt}. Run 'just status' and then 'just stop'; stale receipts are never adopted.`,
    );
  }
  if (existsSync(paths.hermesRestartRequest)) {
    throw new Error(
      `A lifecycle request exists without a foreground owner at ${paths.hermesRestartRequest}. It is never adopted; inspect it and run 'just dev-reset' to clear this worktree's derived process state.`,
    );
  }
  const children = [];
  let stopping = false;
  let stopOutcome;
  const shutdownController = new AbortController();
  let requestStop;
  const stopPromise = new Promise((resolve) => {
    requestStop = (signal) => {
      if (!stopping) {
        stopping = true;
        shutdownController.abort();
        stopOutcome = { kind: "signal", signal };
        resolve(stopOutcome);
      }
    };
  });
  let lifecyclePending = false;
  let restartInProgress = false;
  let refreshInProgress = false;
  let supervisorIdentity;
  let hermesGeneration = 0;
  let runtimeGeneration = 0;
  let resolveLifecycle;
  let lifecyclePromise;
  const armLifecycle = () => {
    lifecyclePromise = new Promise((resolve) => {
      resolveLifecycle = resolve;
    });
  };
  armLifecycle();
  const onInterrupt = () => requestStop("SIGINT");
  const onTerminate = () => requestStop("SIGTERM");
  const onLifecycleRequest = () => {
    if (stopping || lifecyclePending || restartInProgress || refreshInProgress)
      return;
    if (!supervisorIdentity || !existsSync(paths.hermesRestartRequest)) return;
    let operation;
    try {
      const request = readJson(paths.hermesRestartRequest);
      if (
        request.operation !== "restart-hermes" &&
        request.operation !== "refresh-runtime"
      ) {
        return;
      }
      operation = request.operation;
      validateLifecycleRequest(
        paths,
        request,
        supervisorIdentity,
        request.operation,
        request.operation === "refresh-runtime"
          ? runtimeGeneration
          : hermesGeneration,
      );
    } catch {
      return;
    }
    lifecyclePending = true;
    resolveLifecycle({ kind: operation });
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  process.on("SIGUSR1", onLifecycleRequest);
  let primaryError;
  try {
    await assertPortsFree(paths.ports);
    if (services.some((service) => service.name === "hermes")) {
      console.log(
        "Waiting for the native Hermes listener to become safely reusable...",
      );
      if (options.hermesReleaseProof) {
        await options.hermesReleaseProof({ phase: "initial" });
      } else {
        await waitForHermesPortRelease(paths, {
          signal: shutdownController.signal,
        });
      }
      if (stopping) return stopOutcome;
    }
    for (const service of services) {
      children.push(
        await spawnOwnedService(service, options.stdio ?? "inherit"),
      );
    }
    const supervisor = await waitForIdentity(process.pid);
    supervisorIdentity = supervisor;
    const startedAt = new Date().toISOString();
    const writeReceipt = () => {
      if (existsSync(paths.receipt)) {
        const current = validateReceipt(paths, readJson(paths.receipt));
        if (
          current.supervisor?.pid !== supervisor.pid ||
          current.supervisor?.started !== supervisor.started ||
          current.supervisor?.command_sha256 !== supervisor.command_sha256
        ) {
          throw new Error(
            "Refusing to replace a foreground receipt owned by another supervisor.",
          );
        }
      }
      atomicWriteJson(paths.receipt, {
        schema_version: 1,
        stack: paths.id,
        repository: paths.repositoryRoot,
        profile: paths.profile,
        hermes_root: paths.hermesRoot,
        state_root: paths.stateRoot,
        ports: paths.ports,
        supervisor,
        hermes_generation: hermesGeneration,
        hermes_restarting: restartInProgress,
        runtime_generation: runtimeGeneration,
        runtime_refreshing: refreshInProgress,
        children: children.map(({ name, identity }) => ({ name, ...identity })),
        started_at: startedAt,
        updated_at: new Date().toISOString(),
      });
    };
    writeReceipt();
    options.onReceiptOwned?.();
    await Promise.all(
      services.map((service, index) => service.ready(children[index].child)),
    );
    options.onReady?.();

    while (true) {
      const outcome = await Promise.race([
        stopPromise,
        lifecyclePromise,
        ...children.map((item) => item.exit),
      ]);
      if (outcome.kind === "restart-hermes") {
        lifecyclePending = false;
        restartInProgress = true;
        const childIndex = children.findIndex((item) => item.name === "hermes");
        const service = services.find((item) => item.name === "hermes");
        if (childIndex < 0 || !service) {
          throw new Error(
            "The foreground stack has no Hermes service to restart.",
          );
        }
        writeReceipt();
        const previous = children[childIndex];
        console.log(
          "Waiting for the native Hermes listener to become safely reusable...",
        );
        await terminateOwnedService(previous, () =>
          options.hermesReleaseProof
            ? options.hermesReleaseProof({ phase: "restart" })
            : waitForHermesPortRelease(paths, {
                signal: shutdownController.signal,
              }),
        );
        if (stopping) return stopOutcome;
        const replacement = await spawnOwnedService(
          service,
          options.stdio ?? "inherit",
        );
        children[childIndex] = replacement;
        await service.ready(replacement.child);
        const failedSibling = children.find(
          (item, index) =>
            index !== childIndex &&
            (item.child.exitCode !== null || item.child.signalCode !== null),
        );
        if (failedSibling) {
          throw new Error(
            `${failedSibling.name} exited while Hermes was restarting; stopping the stack.`,
          );
        }
        hermesGeneration += 1;
        if (existsSync(paths.hermesRestartRequest)) {
          validateLifecycleRequest(
            paths,
            readJson(paths.hermesRestartRequest),
            supervisor,
            "restart-hermes",
            hermesGeneration - 1,
          );
          rmSync(paths.hermesRestartRequest);
        }
        armLifecycle();
        restartInProgress = false;
        writeReceipt();
        options.onHermesRestart?.(hermesGeneration);
        continue;
      }
      if (outcome.kind === "refresh-runtime") {
        lifecyclePending = false;
        refreshInProgress = true;
        writeReceipt();

        await terminateChildren(children);
        children.splice(0);
        console.log(
          "Waiting for foreground service listeners to become safely reusable...",
        );
        if (services.some((service) => service.name === "hermes")) {
          if (options.hermesReleaseProof) {
            await options.hermesReleaseProof({ phase: "refresh" });
          } else {
            await waitForHermesPortRelease(paths, {
              signal: shutdownController.signal,
            });
          }
        }
        await waitForPortsRelease(paths.ports, 7_000, 250);
        if (stopping) return stopOutcome;

        await options.refreshRuntime?.();
        if (stopping) return stopOutcome;
        for (const service of services) {
          children.push(
            await spawnOwnedService(service, options.stdio ?? "inherit"),
          );
        }
        await Promise.all(
          services.map((service, index) =>
            service.ready(children[index].child),
          ),
        );
        runtimeGeneration += 1;
        hermesGeneration += 1;
        if (existsSync(paths.hermesRestartRequest)) {
          validateLifecycleRequest(
            paths,
            readJson(paths.hermesRestartRequest),
            supervisor,
            "refresh-runtime",
            runtimeGeneration - 1,
          );
          rmSync(paths.hermesRestartRequest);
        }
        armLifecycle();
        refreshInProgress = false;
        writeReceipt();
        options.onRuntimeRefresh?.(runtimeGeneration);
        continue;
      }
      if (outcome.kind === "exit" && !stopping) {
        throw new Error(
          `${outcome.name} exited unexpectedly (${outcome.signal ?? `exit ${outcome.code}`}); stopping the stack.`,
        );
      }
      return outcome;
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    stopping = true;
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    process.removeListener("SIGUSR1", onLifecycleRequest);
    const cleanupErrors = [];
    let processesStopped = false;
    let portsReleased = false;
    try {
      await terminateChildren(children);
      processesStopped = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const startedPorts = Object.fromEntries(
        children
          .filter((item) => Number.isSafeInteger(item.port))
          .map((item) => [item.name, item.port]),
      );
      if (processesStopped && Object.keys(startedPorts).length > 0) {
        if (options.finalReleaseProof) {
          await options.finalReleaseProof(startedPorts);
        } else {
          await waitForPortsRelease(startedPorts, 7_000, 1_500);
        }
      }
      portsReleased = processesStopped;
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const cleanupEstablished = processesStopped && portsReleased;
      if (!cleanupEstablished) {
        cleanupErrors.push(
          new Error(
            "Owned process-group and port cleanup was not proven; preserving its ownership records.",
          ),
        );
      } else if (existsSync(paths.hermesRestartRequest) && supervisorIdentity) {
        try {
          const request = readJson(paths.hermesRestartRequest);
          if (
            request.stack === paths.id &&
            request.repository === paths.repositoryRoot &&
            request.supervisor?.pid === supervisorIdentity.pid &&
            request.supervisor?.started === supervisorIdentity.started &&
            request.supervisor?.command_sha256 ===
              supervisorIdentity.command_sha256
          ) {
            rmSync(paths.hermesRestartRequest);
          }
        } catch {}
      }
      if (cleanupEstablished && existsSync(paths.receipt)) {
        const receipt = readJson(paths.receipt);
        if (
          receipt.stack === paths.id &&
          receipt.repository === paths.repositoryRoot &&
          receipt.supervisor?.pid === process.pid &&
          supervisorIdentity &&
          receipt.supervisor?.started === supervisorIdentity.started &&
          receipt.supervisor?.command_sha256 ===
            supervisorIdentity.command_sha256
        ) {
          rmSync(paths.receipt);
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      const detail = cleanupErrors.map((error) => error.message).join("; ");
      if (primaryError) {
        primaryError.message = `${primaryError.message} Cleanup also failed: ${detail}`;
      } else {
        // biome-ignore lint/correctness/noUnsafeFinally: a failed final ownership proof must fail a successful run after owner records are removed.
        throw new Error(`Development stack cleanup failed: ${detail}`);
      }
    }
  }
}

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
