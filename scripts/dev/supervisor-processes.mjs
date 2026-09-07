import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  assertPortsFree,
  identityMatches,
  processIdentity,
} from "./processes.mjs";

export async function terminateChildren(children) {
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

export async function waitForPortsRelease(ports, timeoutMs, quietMs = 0) {
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

export function waitForHermesPortRelease(paths, options = {}) {
  return waitForNoReuseAddressPortRelease({
    python: join(paths.managedPython, ".venv", "bin", "python"),
    host: "127.0.0.1",
    port: paths.ports.hermes,
    timeoutMs: 75_000,
    quietMs: 1_500,
    signal: options.signal,
  });
}

export async function terminateOwnedService(item, releaseProof) {
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

export function exitOutcome(item) {
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
