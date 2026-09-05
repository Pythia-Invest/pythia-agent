import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";

function psField(pid, field) {
  try {
    return execFileSync("ps", ["-o", `${field}=`, "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function processIdentity(pid) {
  const started = psField(pid, "lstart");
  const command = psField(pid, "command");
  if (!started || !command) return null;
  return {
    pid,
    started,
    command_sha256: createHash("sha256").update(command).digest("hex"),
  };
}

export function identityMatches(expected) {
  if (!expected || !Number.isSafeInteger(expected.pid) || expected.pid <= 1) {
    return false;
  }
  const current = processIdentity(expected.pid);
  return Boolean(
    current &&
      current.started === expected.started &&
      current.command_sha256 === expected.command_sha256,
  );
}

export async function assertPortsFree(ports, host = "127.0.0.1") {
  for (const [name, port] of Object.entries(ports)) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", (error) => {
        reject(
          new Error(
            `${name} port ${host}:${port} is already in use. Stop the owning stack or choose a different worktree path; Pythia will not take over the listener. (${error.code ?? error.message})`,
          ),
        );
      });
      server.listen({ host, port, exclusive: true }, () => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }
}

export async function waitForExit(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIdentity(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processIdentity(pid);
}

export async function signalOwned(expected, signal = "SIGTERM") {
  if (!identityMatches(expected)) {
    throw new Error(
      `Refusing to signal PID ${expected?.pid ?? "?"}: its process identity is stale or belongs to another process.`,
    );
  }
  process.kill(expected.pid, signal);
}
