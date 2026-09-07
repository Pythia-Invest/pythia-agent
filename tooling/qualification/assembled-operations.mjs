import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  SETTINGS_MUTATION_TIMEOUT_MS,
  qualificationRoot,
} from "./assembled-cache.mjs";
import {
  fixture,
  qualificationProcessEnvironment,
} from "./assembled-fixture.mjs";
import {
  deskSession,
  privateStateDigests,
  requestJson,
} from "./assembled-observation.mjs";

export function seedSyntheticState(rootValue, stackName = "one") {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  const files = {
    knowledge: join(stack.paths.knowledge, "qualification-note.md"),
    workspace: join(stack.paths.workspace, "qualification-note.md"),
  };
  mkdirSync(dirname(files.knowledge), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(files.workspace), { recursive: true, mode: 0o700 });
  writeFileSync(files.knowledge, "# Synthetic qualification knowledge\n", {
    mode: 0o600,
  });
  writeFileSync(files.workspace, "Synthetic qualification workspace state\n", {
    mode: 0o600,
  });
  return { files, private_state_sha256: privateStateDigests(stack) };
}

export function runAssembledCommand(rootValue, stackName, command) {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  const display = command.join(" ");
  const allowed = new Set([
    "just dev-init",
    "just dev",
    "just dev-refresh",
    "just status",
    "just stop",
    "just dev-paths",
    "just auth-status openai-codex",
    "node scripts/dev/cli.mjs restart-hermes",
  ]);
  if (!allowed.has(display)) {
    throw new Error(`Unsupported assembled qualification command: ${display}`);
  }
  const result = spawnSync(command[0], command.slice(1), {
    cwd: stack.worktree,
    env: qualificationProcessEnvironment(stack),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Assembled qualification command failed (${result.status}): ${display}`,
    );
  }
  return {
    command,
    environment: "allowlisted-replacement-not-inherited-merge",
    provider_credentials_inherited: false,
    stack: stackName,
  };
}

export async function disableSyntheticSkill(rootValue, stackName = "one") {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  const session = await deskSession(stack);
  const body = JSON.stringify({ enabled: false });
  const response = await requestJson({
    port: stack.ports.desk,
    path: "/api/settings/skills/eodhd-market-data",
    method: "POST",
    headers: {
      ...session.common,
      Cookie: session.cookie,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-pythia-csrf": session.csrf,
    },
    body,
    timeoutMs: SETTINGS_MUTATION_TIMEOUT_MS,
  });
  return { browser_admission: "issued-cookie-and-csrf", result: response.body };
}

export function cleanupAssembledFixture(rootValue) {
  const root = qualificationRoot(rootValue);
  if (!existsSync(root)) return { cleaned: true, existed: false };
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing unsafe qualification cleanup target: ${root}`);
  }
  const { value } = fixture(root);
  const shortOwner = resolve(value.short_configuration_owner ?? "/missing");
  if (
    !shortOwner.startsWith("/tmp/pq-") ||
    value.shared_configuration_owner !== join(shortOwner, "c/pythia") ||
    !existsSync(shortOwner) ||
    !lstatSync(shortOwner).isDirectory() ||
    lstatSync(shortOwner).isSymbolicLink()
  ) {
    throw new Error(
      `Refusing cleanup for an invalid short configuration owner: ${shortOwner}`,
    );
  }
  const ports = [];
  for (const stack of Object.values(value.stacks)) {
    if (existsSync(stack.paths.receipt)) {
      throw new Error(
        `Refusing cleanup while a foreground receipt exists: ${stack.paths.receipt}. Stop the owned stack first.`,
      );
    }
    ports.push(...Object.values(stack.ports));
  }
  const portProbe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import net from "node:net";
const ports = JSON.parse(process.argv[1]);
const servers = [];
try {
  for (const port of ports) {
    const server = net.createServer();
    server.unref();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({host:"127.0.0.1",port,exclusive:true}, resolve);
    });
    servers.push(server);
  }
} finally {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
}`,
      JSON.stringify(ports),
    ],
    { encoding: "utf8" },
  );
  if (portProbe.status !== 0) {
    throw new Error(
      `Refusing cleanup because an owned port is not clear: ${(portProbe.stderr || portProbe.stdout).trim()}`,
    );
  }
  rmSync(root, { recursive: true, maxRetries: 3, retryDelay: 100 });
  rmSync(shortOwner, { recursive: true });
  return {
    cleaned: !existsSync(root) && !existsSync(shortOwner),
    existed: true,
  };
}
