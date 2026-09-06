import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyBasicMemoryReadiness } from "../install/basic-memory-readiness.mjs";
import { identityMatches, processIdentity } from "./processes.mjs";
import { runtimeCommands } from "./runtime.mjs";
import { exitOutcome } from "./supervisor-processes.mjs";

const serviceOwnerPath = fileURLToPath(
  new URL("./service-owner.mjs", import.meta.url),
);

export async function waitForIdentity(pid) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const identity = processIdentity(pid);
    if (identity) return identity;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Could not establish process identity for PID ${pid}.`);
}

export async function spawnOwnedService(service, stdio) {
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
