import { join } from "node:path";
import { workspaceTransitionStatus } from "../update/workspace-transition.mjs";
import { verifyBasicMemoryReadiness } from "../install/basic-memory-readiness.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hermesPin, isPinnedHermesHealth } from "./hermes-pin.mjs";
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
  if (!isPinnedHermesHealth(body)) {
    throw new Error(
      `Hermes health endpoint did not report the pinned hermes-agent ${hermesPin().packageVersion} (got ${JSON.stringify(body?.version ?? null)}).`,
    );
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
  const services = [
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
      name: "desk",
      port: paths.ports.desk,
      command: "pnpm",
      args: commands.desk,
      cwd: paths.repositoryRoot,
      environment,
      ready: () => undefined,
    },
  ];
  // A staged explicit transition keeps the existing environment usable while
  // the user verifies a fresh native session. It is never a fresh default.
  if (workspaceTransitionStatus(paths) === "staged") {
    const legacyEnvironment = {
      ...environment,
      BASIC_MEMORY_CONFIG_DIR: paths.basicMemoryConfig,
      BASIC_MEMORY_NO_PROMOS: "true",
      BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED: "false",
      FASTMCP_CHECK_FOR_UPDATES: "off",
      FASTMCP_SHOW_SERVER_BANNER: "false",
      HF_HOME: join(paths.basicMemoryCache, "huggingface-disabled"),
      FASTEMBED_CACHE_PATH: join(paths.basicMemoryCache, "fastembed-disabled"),
    };
    delete legacyEnvironment.API_SERVER_KEY;
    delete legacyEnvironment.PYTHIA_DESK_VIEW_STATE;
    const executable = join(paths.legacyPython, ".venv", "bin", "basic-memory");
    services.push({
      name: "basic-memory",
      port: paths.ports.memory,
      command: executable,
      args: [
        "mcp",
        "--transport",
        "streamable-http",
        "--host",
        "127.0.0.1",
        "--port",
        String(paths.ports.memory),
        "--path",
        "/mcp",
        "--project",
        paths.id,
      ],
      cwd: paths.repositoryRoot,
      environment: legacyEnvironment,
      ready: (child) =>
        verifyBasicMemoryReadiness(paths, {
          child,
          environment: legacyEnvironment,
          executable,
        }),
    });
  }
  return services;
}
