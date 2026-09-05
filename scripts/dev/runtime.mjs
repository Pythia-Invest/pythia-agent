import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  assertRegularPrivateFile,
  atomicWriteJson,
  copyFileIfAbsent,
  ensurePrivateTree,
  readJson,
  refreshManagedPlugin,
  refreshManagedPythonSource,
} from "./files.mjs";
import { redactedEnvironment, runtimeEnvironment } from "./environment.mjs";

const OAUTH_PROVIDERS = new Set([
  "anthropic",
  "nous",
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "minimax-oauth",
]);

export function assertHermesRuntimePath(paths, platform = process.platform) {
  if (platform !== "darwin" && platform !== "linux") return;
  const limit = platform === "darwin" ? 103 : 107;
  const witness = join(
    paths.profileRoot,
    "state",
    "gateway.loop-tick.9999999999.sock",
  );
  const bytes = Buffer.byteLength(witness);
  if (bytes > limit) {
    throw new Error(
      `Hermes profile path is too long for its required ${platform} loop-liveness socket (${bytes} bytes; maximum ${limit}): ${paths.profileRoot}. Choose a shorter XDG_CONFIG_HOME or PYTHIA_DEV_CONFIG_HOME.`,
    );
  }
}

export function developmentPrivateRoots(paths) {
  return [
    paths.configRoot,
    paths.hermesRoot,
    paths.stateRoot,
    paths.processRoot,
    paths.dataRoot,
    paths.workspace,
    paths.knowledge,
    paths.cacheRoot,
    paths.fetchCache,
    paths.basicMemoryConfig,
    paths.basicMemoryCache,
    paths.edgarData,
    paths.edgarCache,
    paths.testRoot,
  ];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}${detail ? `:\n${detail}` : ""}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

function exactVersion(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

export function validateToolchain(repositoryRoot) {
  const versions = readJson(join(repositoryRoot, "tooling", "toolchain.json"));
  const actual = {
    node: exactVersion("node", ["--version"]).replace(/^v/u, ""),
    pnpm: exactVersion("pnpm", ["--version"]),
    uv: exactVersion("uv", ["--version"]).split(/\s+/u)[1],
  };
  for (const name of Object.keys(actual)) {
    if (actual[name] !== versions[name]) {
      throw new Error(
        `${name} ${versions[name]} is required; found ${actual[name]}. See docs/development.md.`,
      );
    }
  }
  return actual;
}

async function downloadVerified(url, expectedSha256, destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  if (existsSync(destination)) {
    const current = createHash("sha256")
      .update(readFileSync(destination))
      .digest("hex");
    if (current === expectedSha256) return;
    throw new Error(
      `Cached Hermes archive hash mismatch at ${destination}; remove this exact file and retry.`,
    );
  }
  const temporary = `${destination}.${process.pid}.partial`;
  rmSync(temporary, { force: true });
  const response = await fetch(url, {
    headers: { "user-agent": "pythia-agent-development-bootstrap" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Hermes archive download failed with HTTP ${response.status}.`,
    );
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 150 * 1024 * 1024) {
    throw new Error("Hermes archive exceeds the 150 MiB bootstrap limit.");
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const source = Readable.fromWeb(response.body).map((chunk) => {
    bytes += chunk.length;
    if (bytes > 150 * 1024 * 1024) {
      throw new Error("Hermes archive exceeds the 150 MiB bootstrap limit.");
    }
    hash.update(chunk);
    return chunk;
  });
  try {
    await pipeline(source, createWriteStream(temporary, { mode: 0o600 }));
    const actual = hash.digest("hex");
    if (actual !== expectedSha256) {
      throw new Error(
        `Hermes archive hash mismatch: expected ${expectedSha256}, got ${actual}.`,
      );
    }
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const HERMES_SOURCE_DERIVED_NAMES = new Set([
  ".pythia-source.json",
  ".venv",
  "__pycache__",
]);

function hermesSourceDigest(root) {
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Hermes source must be a real directory: ${root}`);
  }
  const hash = createHash("sha256");
  function walk(current, relative = "") {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (
        HERMES_SOURCE_DERIVED_NAMES.has(entry.name) ||
        (relative === "" && entry.name === "hermes_agent.egg-info") ||
        entry.name.endsWith(".pyc")
      ) {
        continue;
      }
      const child = join(current, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childInfo = lstatSync(child);
      if (childInfo.isSymbolicLink()) {
        throw new Error(
          `Hermes source contains an unsupported symbolic link: ${child}`,
        );
      }
      if (childInfo.isDirectory()) {
        hash.update(`directory\0${childRelative}\0${childInfo.mode & 0o777}\n`);
        walk(child, childRelative);
      } else if (childInfo.isFile()) {
        hash.update(`file\0${childRelative}\0${childInfo.mode & 0o777}\0`);
        hash.update(readFileSync(child));
        hash.update("\n");
      } else {
        throw new Error(
          `Hermes source contains an unsupported entry: ${child}`,
        );
      }
    }
  }
  walk(root);
  return hash.digest("hex");
}

function validateExtractedHermesSource(source) {
  for (const required of ["uv.lock", "pyproject.toml"]) {
    if (!existsSync(join(source, required))) {
      throw new Error(`Verified Hermes archive lacks ${required}.`);
    }
  }
  return hermesSourceDigest(source);
}

export async function ensureHermesSource(paths, sourceContract) {
  const archive = join(
    paths.fetchCache,
    `hermes-${sourceContract.commit}.tar.gz`,
  );
  await downloadVerified(
    sourceContract.archive_url,
    sourceContract.archive_sha256,
    archive,
  );
  if (existsSync(paths.hermesSource)) {
    const current = lstatSync(paths.hermesSource);
    if (!current.isDirectory() || current.isSymbolicLink()) {
      throw new Error(
        `Hermes source cache must be a real directory: ${paths.hermesSource}`,
      );
    }
  }

  const parent = dirname(paths.hermesSource);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, ".pythia-hermes-source-"));
  const candidate = join(stage, "source");
  const previous = join(stage, "previous");
  mkdirSync(candidate, { recursive: true, mode: 0o700 });
  try {
    run("tar", ["-xzf", archive, "--strip-components=1", "-C", candidate]);
    const expectedDigest = validateExtractedHermesSource(candidate);
    let currentDigest = null;
    if (existsSync(paths.hermesSource)) {
      try {
        currentDigest = hermesSourceDigest(paths.hermesSource);
      } catch {
        currentDigest = null;
      }
    }
    if (currentDigest !== expectedDigest) {
      if (existsSync(paths.hermesSource)) {
        renameSync(paths.hermesSource, previous);
      }
      try {
        renameSync(candidate, paths.hermesSource);
      } catch (error) {
        if (existsSync(previous)) renameSync(previous, paths.hermesSource);
        throw error;
      }
    }
    atomicWriteJson(join(paths.hermesSource, ".pythia-source.json"), {
      schema_version: 1,
      release: sourceContract.release,
      commit: sourceContract.commit,
      archive_sha256: sourceContract.archive_sha256,
      source_tree_sha256: expectedDigest,
    });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

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

function secrets(paths) {
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

function hermesRun(paths, args, apiKey, options = {}) {
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

function configureFreshProfile(paths, apiKey) {
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

export async function prepareManagedRuntime(paths, options = {}) {
  const sourceContract =
    options.sourceContract ??
    readJson(
      join(
        paths.repositoryRoot,
        "runtime",
        "managed",
        "python",
        "hermes-source.json",
      ),
    );
  const prepareHermesSource = options.ensureHermesSource ?? ensureHermesSource;
  const execute = options.runCommand ?? run;
  const environment =
    options.environment ??
    redactedEnvironment(options.sourceEnvironment ?? process.env);
  const managedPythonSource =
    paths.managedPythonSource ??
    join(paths.repositoryRoot, "runtime", "managed", "python");

  await prepareHermesSource(paths, sourceContract);
  if (resolve(managedPythonSource) !== resolve(paths.managedPython)) {
    refreshManagedPythonSource(managedPythonSource, paths.managedPython);
  }

  const [hermesUv, ...hermesUvArguments] = sourceContract.install.command;
  if (hermesUv !== "uv" || hermesUvArguments.length === 0) {
    throw new Error(
      "Hermes source contract contains an unsupported install command.",
    );
  }
  execute(hermesUv, hermesUvArguments, {
    cwd: paths.hermesSource,
    env: { ...environment, UV_PYTHON: "3.12.11" },
  });
  execute("uv", ["sync", "--frozen", "--project", paths.managedPython], {
    cwd: paths.repositoryRoot,
    env: { ...environment, UV_PYTHON: "3.12.11" },
  });
  execute("pnpm", ["install", "--frozen-lockfile"], {
    cwd: paths.repositoryRoot,
    env: environment,
  });
  execute("pnpm", runtimeCommands(paths).managedRunnerBuild, {
    cwd: paths.repositoryRoot,
    env: environment,
  });
  return { sourceContract, environment };
}

function configureBasicMemory(paths, environment, basicMemory) {
  const marker = join(paths.stateRoot, "basic-memory-project.json");
  run(basicMemory, ["config", "set", "auto_update", "false"], {
    env: environment,
    cwd: paths.repositoryRoot,
  });
  if (!existsSync(marker)) {
    run(
      basicMemory,
      ["project", "add", paths.id, paths.knowledge, "--local", "--default"],
      { env: environment, cwd: paths.repositoryRoot },
    );
    atomicWriteJson(marker, {
      schema_version: 1,
      project: paths.id,
      path: paths.knowledge,
    });
  } else {
    const current = readJson(marker);
    if (current.project !== paths.id || current.path !== paths.knowledge) {
      throw new Error(
        "Basic Memory project receipt does not match this worktree.",
      );
    }
  }
}

function initializationReceipt(paths) {
  if (!existsSync(paths.profileInitialization)) return null;
  const receipt = readJson(paths.profileInitialization);
  if (
    receipt.schema_version !== 1 ||
    receipt.stack !== paths.id ||
    receipt.repository !== paths.repositoryRoot ||
    receipt.profile !== paths.profile ||
    receipt.hermes_root !== paths.hermesRoot ||
    receipt.state_root !== paths.stateRoot ||
    receipt.profile_initially_absent !== true
  ) {
    throw new Error(
      `Refusing a profile-initialization receipt that does not belong to this worktree: ${paths.profileInitialization}`,
    );
  }
  return receipt;
}

function writeInitializationReceipt(paths, status) {
  atomicWriteJson(paths.profileInitialization, {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    profile: paths.profile,
    hermes_root: paths.hermesRoot,
    state_root: paths.stateRoot,
    profile_initially_absent: true,
    status,
    updated_at: new Date().toISOString(),
  });
}

export function recoverInterruptedProfileInitialization(paths, options = {}) {
  const receipt = initializationReceipt(paths);
  if (!receipt || receipt.status === "complete") {
    throw new Error(
      "There is no interrupted Pythia profile initialization to recover.",
    );
  }
  if (existsSync(paths.receipt)) {
    throw new Error(
      `Refusing initialization recovery while a foreground receipt exists: ${paths.receipt}`,
    );
  }
  if (receipt.status === "started" && existsSync(paths.profileRoot)) {
    throw new Error(
      `The initialization receipt proves only that Pythia intended to create ${paths.profileRoot}; the existing profile's ownership is ambiguous. Refusing to delete it. Inspect the profile and receipt manually before retrying.`,
    );
  }
  if (
    receipt.status !== "started" &&
    receipt.status !== "native-profile-created" &&
    receipt.status !== "seeds-installed"
  ) {
    throw new Error(
      `Unknown profile-initialization status '${receipt.status}'; refusing recovery.`,
    );
  }
  if (existsSync(paths.profileRoot)) {
    const info = lstatSync(paths.profileRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(
        `Interrupted profile target is not a real directory: ${paths.profileRoot}`,
      );
    }
    rmSync(paths.profileRoot, { recursive: true, force: true });
  }
  rmSync(paths.profileInitialization);
  return {
    recovered: true,
    removed_profile: paths.profileRoot,
    preserved_credential_root: paths.hermesRoot,
    next: options.next ?? "just dev-init",
  };
}

export async function bootstrapRuntime(paths, options = {}) {
  validateToolchain(paths.repositoryRoot);
  assertHermesRuntimePath(paths);
  ensurePrivateTree(developmentPrivateRoots(paths));
  const values = secrets(paths);
  const commands = runtimeCommands(paths);
  const { sourceContract } = await prepareManagedRuntime(paths);

  let initialization = initializationReceipt(paths);
  if (initialization && initialization.status !== "complete") {
    if (!existsSync(paths.profileRoot) && initialization.status === "started") {
      rmSync(paths.profileInitialization);
      initialization = null;
    } else {
      throw new Error(
        `Pythia profile initialization was interrupted at '${initialization.status}'. The partial profile is not adopted or preserved. Inspect the receipt, then run '${options.initializationRecoveryCommand ?? "just dev-init-recover"}' to remove only that transaction-owned profile before retrying.`,
      );
    }
  }
  let freshProfile = false;
  if (!existsSync(paths.profileRoot)) {
    if (initialization?.status === "complete") {
      throw new Error(
        `The completed initialization receipt points to a missing profile: ${paths.profileRoot}. Refusing to recreate it implicitly.`,
      );
    }
    writeInitializationReceipt(paths, "started");
    hermesRun(paths, commands.profileCreate, values.hermes_api_key);
    writeInitializationReceipt(paths, "native-profile-created");
    freshProfile = true;
  } else if (initialization?.status !== "complete") {
    throw new Error(
      `Refusing to adopt an existing non-Pythia Hermes profile at ${paths.profileRoot}.`,
    );
  } else if (
    !existsSync(join(paths.profileRoot, "config.yaml")) ||
    !existsSync(join(paths.profileRoot, ".no-bundled-skills"))
  ) {
    throw new Error(
      `Pythia Hermes profile is incomplete at ${paths.profileRoot}.`,
    );
  }
  if (freshProfile) {
    installSeeds(paths, { freshProfile: true });
    writeInitializationReceipt(paths, "seeds-installed");
    configureFreshProfile(paths, values.hermes_api_key);
  } else {
    ensureNativeWorkspaceCwd(paths, values.hermes_api_key);
  }
  if (options.inheritSharedModel !== false)
    inheritModelDefaults(paths, values.hermes_api_key);
  refreshManagedPlugin(
    paths.managedPlugin,
    join(paths.profileRoot, "plugins", "pythia"),
  );
  const copiedPlugin = join(paths.profileRoot, "plugins", "pythia");
  hermesRun(
    paths,
    ["-p", paths.profile, "plugins", "doctor", copiedPlugin, "--ci"],
    values.hermes_api_key,
  );
  if (freshProfile) {
    hermesRun(
      paths,
      [
        "-p",
        paths.profile,
        "plugins",
        "enable",
        "pythia",
        "--no-allow-tool-override",
      ],
      values.hermes_api_key,
    );
  }
  const environment = runtimeEnvironment(paths, values.hermes_api_key);
  configureBasicMemory(paths, environment, commands.basicMemory);
  if (freshProfile) writeInitializationReceipt(paths, "complete");
  atomicWriteJson(paths.runtimeReceipt, {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    profile: paths.profile,
    hermes_root: paths.hermesRoot,
    state_root: paths.stateRoot,
    hermes: sourceContract,
    basic_memory: "0.23.2",
    managed_python_lock: basename(join(paths.managedPython, "uv.lock")),
    initialized_at: new Date().toISOString(),
  });
  return { commands, environment };
}

export async function refreshRuntimeAssets(paths, apiKey) {
  refreshManagedPlugin(
    paths.managedPlugin,
    join(paths.profileRoot, "plugins", "pythia"),
  );
  hermesRun(
    paths,
    [
      "-p",
      paths.profile,
      "plugins",
      "doctor",
      join(paths.profileRoot, "plugins", "pythia"),
      "--ci",
    ],
    apiKey,
  );
}

export function readApiKey(paths) {
  return secrets(paths).hermes_api_key;
}

function initializedNativeHermes(paths) {
  if (!existsSync(paths.runtimeReceipt)) {
    throw new Error(
      "Pythia runtime tooling is not initialized. Run 'just dev-init' before using native Hermes authentication.",
    );
  }
  const receipt = readJson(paths.runtimeReceipt);
  if (
    receipt.schema_version !== 1 ||
    receipt.stack !== paths.id ||
    receipt.repository !== paths.repositoryRoot ||
    receipt.profile !== paths.profile ||
    receipt.hermes_root !== paths.hermesRoot ||
    receipt.state_root !== paths.stateRoot
  ) {
    throw new Error(
      `Refusing a runtime receipt that does not belong to this worktree: ${paths.runtimeReceipt}`,
    );
  }
  const hermes = runtimeCommands(paths).hermes;
  if (!existsSync(hermes)) {
    throw new Error(
      "Pythia runtime tooling is incomplete. Run 'just dev-init' before using native Hermes authentication.",
    );
  }
  const executable = lstatSync(hermes);
  if (!executable.isFile() || executable.isSymbolicLink()) {
    throw new Error(
      `Native Hermes executable is not a regular file: ${hermes}`,
    );
  }
  return hermes;
}

function nativeRootAuthRun(paths, action, provider, options = {}) {
  return run(
    initializedNativeHermes(paths),
    [
      "-p",
      "default",
      ...nativeRootAuthArguments(action, provider, options.type),
    ],
    {
      cwd: paths.repositoryRoot,
      env: {
        ...redactedEnvironment(process.env),
        HERMES_HOME: paths.hermesRoot,
      },
      interactive: options.interactive,
    },
  );
}

export async function authenticate(paths, provider, type = "oauth") {
  const normalized = String(provider ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.startsWith("-"))
    throw new Error("Provide a native Hermes provider name.");
  if (type === "oauth" && !OAUTH_PROVIDERS.has(normalized)) {
    const release = readJson(
      join(paths.repositoryRoot, "runtime", "versions.json"),
    ).dependencies.hermes_agent.package_version;
    throw new Error(
      `Hermes ${release} does not support native OAuth for '${normalized || "<missing>"}'. Supported providers: ${[...OAUTH_PROVIDERS].join(", ")}.`,
    );
  }
  nativeRootAuthRun(paths, "add", normalized, {
    interactive: true,
    type,
  });
}

export function configureSharedModel(paths) {
  return run(initializedNativeHermes(paths), ["-p", "default", "model"], {
    cwd: paths.repositoryRoot,
    env: { ...redactedEnvironment(process.env), HERMES_HOME: paths.hermesRoot },
    interactive: true,
  });
}

export async function authenticationStatus(paths, provider) {
  const normalized = String(provider ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.startsWith("-")) {
    throw new Error("Provide a native Hermes provider name.");
  }
  return nativeRootAuthRun(paths, "status", normalized);
}

export { OAUTH_PROVIDERS };
