import { existsSync, rmSync } from "node:fs";
import { atomicWriteJson, readJson } from "./files.mjs";
import { assertPortsFree, identityMatches } from "./processes.mjs";
import { spawnOwnedService, waitForIdentity } from "./supervisor-services.mjs";
import {
  terminateChildren,
  terminateOwnedService,
  waitForHermesPortRelease,
  waitForPortsRelease,
} from "./supervisor-processes.mjs";
import {
  validateLifecycleRequest,
  validateReceipt,
} from "./supervisor-admission.mjs";

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
