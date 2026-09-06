import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertRegularPrivateFile,
  atomicWriteJson,
  copyFileIfAbsent,
  readJson,
} from "./files.mjs";
import { runtimeEnvironment } from "./environment.mjs";
import { run } from "./runtime-source.mjs";

export function runtimeCommands(paths) {
  const hermes = join(paths.hermesSource, ".venv", "bin", "hermes");
  const basicMemory = join(paths.managedPython, ".venv", "bin", "basic-memory");
  return {
    hermes,
    basicMemory,
    profileCreate: [
      "profile",
      "create",
      paths.profile,
      "--no-alias",
      "--no-skills",
    ],
    hermesGateway: [
      "-p",
      paths.profile,
      "gateway",
      "run",
      "--external-supervisor",
    ],
    basicMemoryMcp: [
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
    managedRunnerBuild: ["run", "build:runtime"],
    desk: [
      "--filter",
      "@pythia/desk",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(paths.ports.desk),
    ],
  };
}

export function nativeRootAuthArguments(action, provider, type = "oauth") {
  if (action === "add") {
    if (!["oauth", "api-key"].includes(type))
      throw new Error("Use oauth or api-key authentication.");
    return ["auth", "add", "--type", type, provider];
  }
  if (action === "status" || action === "logout") {
    return ["auth", action, provider];
  }
  throw new Error(`Unsupported native Hermes auth action: ${action}`);
}

export function secrets(paths) {
  const path = join(paths.configRoot, "secrets.json");
  if (existsSync(path)) {
    assertRegularPrivateFile(path);
    const value = readJson(path);
    if (
      typeof value.hermes_api_key !== "string" ||
      value.hermes_api_key.length < 16
    ) {
      throw new Error(
        `Hermes API bearer is missing or invalid in ${path}; repair it through the Pythia device-settings owner.`,
      );
    }
    return value;
  }
  const value = {
    schema_version: 1,
    hermes_api_key: randomBytes(32).toString("base64url"),
  };
  atomicWriteJson(path, value);
  return value;
}

function seedDestination(paths, destination) {
  if (destination.startsWith("hermes-profile/")) {
    return join(paths.profileRoot, destination.slice("hermes-profile/".length));
  }
  if (destination.startsWith("workspace/")) {
    return join(paths.workspace, destination.slice("workspace/".length));
  }
  if (destination.startsWith("knowledge/")) {
    return join(paths.knowledge, destination.slice("knowledge/".length));
  }
  throw new Error(`Unsupported seed destination: ${destination}`);
}

export function installSeeds(paths, { freshProfile = false } = {}) {
  if (!freshProfile) {
    return {
      installed: [],
      preserved: [],
      skipped: "profile-already-initialized",
    };
  }
  const seedsRoot = join(paths.repositoryRoot, "runtime", "seeds");
  const manifestPath = join(seedsRoot, "manifest.json");
  const manifest = readJson(manifestPath);
  const installed = [];
  const preserved = [];
  for (const entry of manifest.entries) {
    const source = join(seedsRoot, entry.source);
    const destination = seedDestination(paths, entry.destination);
    const isFreshScaffold =
      freshProfile && entry.destination.startsWith("hermes-profile/");
    if (isFreshScaffold && existsSync(destination)) {
      const info = lstatSync(destination);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(
          `Fresh Hermes scaffold is not a regular file: ${destination}`,
        );
      }
      rmSync(destination);
    }
    if (copyFileIfAbsent(source, destination, Number.parseInt(entry.mode, 8))) {
      installed.push(entry.destination);
    } else {
      preserved.push(entry.destination);
    }
  }
  atomicWriteJson(join(paths.stateRoot, "seed-receipt.json"), {
    schema_version: 1,
    manifest_sha256: createHash("sha256")
      .update(readFileSync(manifestPath))
      .digest("hex"),
    fresh_profile_transaction: freshProfile,
    installed,
    preserved,
  });
  return { installed, preserved };
}

export function hermesRun(paths, args, apiKey, options = {}) {
  const commands = runtimeCommands(paths);
  const environment = runtimeEnvironment(paths, apiKey);
  return run(commands.hermes, args, {
    cwd: paths.repositoryRoot,
    env: environment,
    interactive: options.interactive,
  });
}

export function inheritModelDefaults(
  paths,
  apiKey,
  { execute = hermesRun } = {},
) {
  const prefix = ["-p", paths.profile, "config"];
  const current = JSON.parse(
    execute(paths, [...prefix, "get", "model", "--json"], apiKey),
  );
  // Any existing choice or partial configuration belongs to this profile.
  if (
    typeof current === "string"
      ? current.trim()
      : current && Object.keys(current).length
  )
    return false;
  const shared = JSON.parse(
    execute(
      paths,
      ["-p", "default", "config", "get", "model", "--json"],
      apiKey,
    ),
  );
  if (!shared || typeof shared !== "object" || Array.isArray(shared))
    return false;
  if (!shared.provider || !shared.default) return false;
  const selection = {};
  for (const key of ["provider", "default", "base_url", "api_mode"]) {
    const value = shared[key];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string")
      throw new Error("Shared model selection must use native string fields.");
    if (key === "base_url") {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash)
        throw new Error(
          "Shared model endpoint must not contain credentials, query parameters or fragments.",
        );
    }
    selection[key] = value;
  }
  // Upstream treats bare `model` as string-typed even for a JSON object.
  // Dotted native setters create the mapping without writing YAML ourselves.
  for (const [key, value] of Object.entries(selection)) {
    execute(paths, [...prefix, "set", `model.${key}`, value], apiKey);
  }
  const saved = JSON.parse(
    execute(paths, [...prefix, "get", "model", "--json"], apiKey),
  );
  if (Object.entries(selection).some(([key, value]) => saved?.[key] !== value))
    throw new Error("Hermes did not retain the shared model selection.");
  return true;
}

export function configureFreshProfile(paths, apiKey) {
  ensureNativeWorkspaceCwd(paths, apiKey, { freshProfile: true });
  hermesRun(
    paths,
    [
      "-p",
      paths.profile,
      "config",
      "set",
      "skills.external_dirs",
      JSON.stringify([paths.managedSkills]),
    ],
    apiKey,
  );
  hermesRun(
    paths,
    [
      "-p",
      paths.profile,
      "config",
      "set",
      "mcp_servers.basic-memory",
      JSON.stringify({
        url: `http://127.0.0.1:${paths.ports.memory}/mcp`,
        enabled: true,
        timeout: 30,
        connect_timeout: 10,
        supports_parallel_tool_calls: false,
        tools: { resources: true, prompts: true },
      }),
    ],
    apiKey,
  );
}

export function ensureNativeWorkspaceCwd(
  paths,
  apiKey,
  { freshProfile = false, execute = hermesRun } = {},
) {
  const workspace = resolve(paths.workspace);
  if (freshProfile) {
    execute(
      paths,
      ["-p", paths.profile, "config", "set", "terminal.cwd", workspace],
      apiKey,
    );
  }

  let configured;
  try {
    const output = execute(
      paths,
      ["-p", paths.profile, "config", "get", "terminal.cwd", "--json"],
      apiKey,
    );
    configured = JSON.parse(output);
  } catch (error) {
    if (
      !freshProfile &&
      error instanceof Error &&
      /Config key not set: terminal\.cwd/u.test(error.message)
    ) {
      throw new Error(
        `The existing Hermes profile has no terminal.cwd. Pythia will not silently migrate profile-owned configuration. Run the pinned native command, then retry: HERMES_HOME=${JSON.stringify(paths.hermesRoot)} ${JSON.stringify(runtimeCommands(paths).hermes)} -p ${paths.profile} config set terminal.cwd ${JSON.stringify(workspace)}`,
      );
    }
    throw error;
  }
  if (typeof configured !== "string" || configured.length === 0) {
    throw new Error("Native Hermes returned an invalid terminal.cwd readback.");
  }
  if (freshProfile && configured !== workspace) {
    throw new Error(
      `Native Hermes did not retain the seeded terminal.cwd (${configured}).`,
    );
  }
  return configured;
}
