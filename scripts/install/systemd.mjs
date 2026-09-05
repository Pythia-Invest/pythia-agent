import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { atomicWrite } from "./files.mjs";

export const UNIT_NAMES = [
  "pythia-agent-basic-memory.service",
  "pythia-agent-hermes.service",
  "pythia-agent-desk.service",
  "pythia-agent.target",
];

function systemdQuote(value) {
  if (/\r|\n|\0/u.test(value)) throw new Error("Unsafe systemd path value.");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}

// Single-path directives do not use ExecStart's shell-like word parser.
function systemdPath(value) {
  if (
    !value.startsWith("/") ||
    /[\r\n\0]/u.test(value) ||
    value.trim() !== value
  )
    throw new Error("Unsafe systemd directive path.");
  return value.replaceAll("%", "%%");
}

function environmentValue(value) {
  if (/\r|\n|\0/u.test(value))
    throw new Error("Unsafe service environment value.");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function serializeEnvironment(values) {
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${environmentValue(value)}`)
    .join("\n")}\n`;
}

function installRoots(paths) {
  return {
    XDG_CONFIG_HOME: dirname(paths.configRoot),
    XDG_STATE_HOME: dirname(paths.stateRoot),
    XDG_DATA_HOME: dirname(paths.dataRoot),
    XDG_CACHE_HOME: dirname(paths.cacheRoot),
    PYTHIA_INSTALL_CONFIG_HOME: dirname(paths.configRoot),
    PYTHIA_INSTALL_STATE_HOME: dirname(paths.stateRoot),
    PYTHIA_INSTALL_DATA_HOME: dirname(paths.dataRoot),
    PYTHIA_INSTALL_CACHE_HOME: dirname(paths.cacheRoot),
    PYTHIA_INSTALL_BIN_HOME: paths.binRoot,
    PYTHIA_INSTALL_SYSTEMD_HOME: paths.unitRoot,
  };
}

export function serviceEnvironmentValues(paths, executables) {
  const path = [
    join(paths.runtimeRoot, "node", "22.16.0", "bin"),
    join(paths.runtimeRoot, "uv", "0.9.28"),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(":");
  const hermes = {
    HOME: process.env.HOME ?? "",
    HERMES_HOME: paths.hermesRoot,
    HERMES_DISABLE_LAZY_INSTALLS: "1",
    PYTHIA_CONFIG_ROOT: paths.configRoot,
    PYTHIA_MANAGED_ROOT: paths.managedRoot,
    PYTHIA_EDGAR_DATA_DIR: paths.edgarData,
    PYTHIA_EDGAR_CACHE_DIR: paths.edgarCache,
    PYTHIA_PYTHON: executables.managedPython,
    PYTHIA_NODE: executables.node,
    API_SERVER_HOST: "127.0.0.1",
    API_SERVER_PORT: String(paths.ports.hermes),
    PYTHIA_BASIC_MEMORY_MCP_URL: `http://127.0.0.1:${paths.ports.memory}/mcp`,
    PATH: path,
  };
  const basicMemory = {
    HOME: process.env.HOME ?? "",
    BASIC_MEMORY_CONFIG_DIR: paths.basicMemoryConfig,
    BASIC_MEMORY_NO_PROMOS: "true",
    BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED: "false",
    FASTMCP_CHECK_FOR_UPDATES: "off",
    FASTMCP_SHOW_SERVER_BANNER: "false",
    HF_HOME: join(paths.basicMemoryCache, "huggingface-disabled"),
    FASTEMBED_CACHE_PATH: join(paths.basicMemoryCache, "fastembed-disabled"),
    XDG_CACHE_HOME: paths.cacheRoot,
    PATH: path,
  };
  const desk = {
    HOME: process.env.HOME ?? "",
    HERMES_HOME: paths.hermesRoot,
    PYTHIA_CONFIG_ROOT: paths.configRoot,
    PYTHIA_STATE_ROOT: paths.stateRoot,
    PYTHIA_HERMES_API_URL: `http://127.0.0.1:${paths.ports.hermes}`,
    PYTHIA_BASIC_MEMORY_MCP_URL: `http://127.0.0.1:${paths.ports.memory}/mcp`,
    PYTHIA_HERMES_EXECUTABLE: executables.hermes,
    PYTHIA_HERMES_PROFILE: paths.profile,
    PYTHIA_LIFECYCLE_COMMAND: paths.installedCommand,
    ...installRoots(paths),
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(paths.ports.desk),
    HOSTNAME: "127.0.0.1",
    PATH: path,
  };
  return { hermes, basicMemory, desk };
}

export function serviceEnvironments(paths, executables) {
  const values = serviceEnvironmentValues(paths, executables);
  return Object.fromEntries(
    Object.entries(values).map(([name, environment]) => [
      name,
      serializeEnvironment(environment),
    ]),
  );
}

function replacements(paths, executables) {
  return {
    "@@HERMES_ENVIRONMENT_FILE@@": systemdPath(
      paths.serviceEnvironments.hermes,
    ),
    "@@BASIC_MEMORY_ENVIRONMENT_FILE@@": systemdPath(
      paths.serviceEnvironments.basicMemory,
    ),
    "@@DESK_ENVIRONMENT_FILE@@": systemdPath(paths.serviceEnvironments.desk),
    "@@CHECKOUT@@": systemdPath(paths.checkout),
    "@@DESK_ROOT@@": systemdPath(join(paths.checkout, "apps", "desk")),
    "@@WORKSPACE@@": systemdPath(paths.workspace),
    "@@SERVICE_LAUNCHER@@": systemdQuote(paths.serviceLauncher),
    "@@HERMES@@": systemdQuote(executables.hermes),
    "@@BASIC_MEMORY@@": systemdQuote(executables.basicMemory),
    "@@PYTHON@@": systemdQuote(executables.python),
    "@@NODE@@": systemdQuote(executables.node),
    "@@NEXT@@": systemdQuote(executables.next),
  };
}

export function renderUnits(paths, executables) {
  const sourceRoot = join(paths.checkout, "packaging", "systemd");
  const values = replacements(paths, executables);
  return Object.fromEntries(
    UNIT_NAMES.map((name) => {
      let content = readFileSync(join(sourceRoot, `${name}.in`), "utf8");
      for (const [token, value] of Object.entries(values)) {
        content = content.replaceAll(token, value);
      }
      if (/@@[A-Z_]+@@/u.test(content)) {
        throw new Error(`Unresolved systemd placeholder in ${name}.`);
      }
      return [name, content];
    }),
  );
}

export function installUnits(paths, units) {
  mkdirSync(paths.unitRoot, { recursive: true, mode: 0o700 });
  const stage = join(paths.unitRoot, `.pythia-units.${process.pid}.stage`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  try {
    for (const [name, content] of Object.entries(units)) {
      writeFileSync(join(stage, name), content, { mode: 0o600 });
    }
    for (const name of UNIT_NAMES) {
      const destination = join(paths.unitRoot, name);
      if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
        throw new Error(
          `Refusing to replace symlinked user unit: ${destination}`,
        );
      }
      const source = join(stage, name);
      chmodSync(source, 0o644);
      renameSync(source, destination);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function writeServiceEnvironment(paths, _apiKey, executables) {
  const values = serviceEnvironments(paths, executables);
  atomicWrite(paths.serviceEnvironments.hermes, values.hermes);
  atomicWrite(paths.serviceEnvironments.basicMemory, values.basicMemory);
  atomicWrite(paths.serviceEnvironments.desk, values.desk);
  // Releases before this split persisted the bearer in one shared file. It is
  // not an authority and must not survive once role-scoped transport exists.
  rmSync(paths.serviceEnvironment, { force: true });
}

export function systemctl(args, options = {}) {
  const result = spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
    env: options.environment ?? process.env,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 120_000,
  });
  if (result.error) throw result.error;
  if (!(options.allowedStatuses ?? [0]).includes(result.status)) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `systemctl --user ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

export function refreshUnitManager() {
  systemctl(["daemon-reload"]);
  const loadState = systemctl([
    "show",
    "pythia-agent.target",
    "--property=LoadState",
    "--value",
  ]);
  if (loadState !== "loaded")
    throw new Error("systemd did not load pythia-agent.target.");
}

export function unitExpectations(paths, executables) {
  return {
    "pythia-agent-basic-memory.service": [
      executables.basicMemory,
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
    "pythia-agent-hermes.service": [
      executables.python,
      paths.serviceLauncher,
      "hermes",
      executables.hermes,
      "-p",
      paths.profile,
      "gateway",
      "run",
      "--external-supervisor",
    ],
    "pythia-agent-desk.service": [
      executables.python,
      paths.serviceLauncher,
      "desk",
      executables.node,
      executables.next,
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(paths.ports.desk),
    ],
  };
}

export function verifyOwnedUnits(paths, executables, options = {}) {
  const query = options.systemctl ?? systemctl;
  const read = options.readFile ?? ((path) => readFileSync(path, "utf8"));
  const units = renderUnits(paths, executables);
  const expectations = unitExpectations(paths, executables);
  if (
    options.requireEnabled !== false &&
    query(["is-enabled", "pythia-agent.target"]) !== "enabled"
  ) {
    throw new Error("The owned pythia-agent.target is not enabled.");
  }
  for (const name of UNIT_NAMES) {
    if (query(["is-active", name]) !== "active") {
      throw new Error(`The owned systemd unit is not active: ${name}`);
    }
    const fragment = query([
      "show",
      name,
      "--property=FragmentPath",
      "--value",
    ]);
    const expectedFragment = join(paths.unitRoot, name);
    if (resolve(fragment) !== resolve(expectedFragment)) {
      throw new Error(`systemd loaded an unexpected unit file for ${name}.`);
    }
    if (read(expectedFragment) !== units[name]) {
      throw new Error(`The loaded unit file differs from Pythia's ${name}.`);
    }
    const expectedCommand = expectations[name];
    if (!expectedCommand) continue;
    const pid = query(["show", name, "--property=MainPID", "--value"]);
    if (!/^[1-9][0-9]*$/u.test(pid)) {
      throw new Error(`The owned systemd unit has no MainPID: ${name}.`);
    }
    const execStart = query(["show", name, "--property=ExecStart", "--value"]);
    const expectedArgv = expectedCommand.join(" ");
    if (
      !execStart.includes(`path=${expectedCommand[0]} ;`) ||
      !execStart.includes(`argv[]=${expectedArgv} ;`)
    ) {
      throw new Error(`systemd loaded an unexpected ExecStart for ${name}.`);
    }
  }
  return { owned: true, units: [...UNIT_NAMES] };
}

export function serviceAction(action, options = {}) {
  const control = options.systemctl ?? systemctl;
  if (action === "start") {
    control(["start", "pythia-agent.target"]);
    return;
  }
  if (action === "enable") {
    control(["enable", "pythia-agent.target"]);
    if (control(["is-enabled", "pythia-agent.target"]) !== "enabled") {
      throw new Error("The owned pythia-agent.target was not enabled.");
    }
    return;
  }
  if (action === "stop") {
    control(["disable", "pythia-agent.target"], { allowedStatuses: [0, 1] });
    const enabled = control(["is-enabled", "pythia-agent.target"], {
      allowedStatuses: [0, 1, 4],
    });
    if (!["disabled", "not-found"].includes(enabled)) {
      throw new Error(
        "The owned pythia-agent.target disablement was not confirmed.",
      );
    }
    // Stopping the target queues PartOf jobs, but does not wait for each one.
    control(["stop", ...UNIT_NAMES], { allowedStatuses: [0, 5] });
    for (const name of UNIT_NAMES) {
      const state = control(["is-active", name], {
        allowedStatuses: [0, 3, 4],
      });
      // Native processes can exit nonzero on SIGTERM. A failed unit is stopped
      // only when systemd reports no main/control process or remaining cgroup.
      if (
        state === "failed" &&
        control(["show", name, "--property=MainPID", "--value"]) === "0" &&
        control(["show", name, "--property=ControlPID", "--value"]) === "0" &&
        control(["show", name, "--property=ControlGroup", "--value"]) === ""
      )
        continue;
      if (!["inactive", "unknown"].includes(state)) {
        throw new Error(`The owned systemd unit did not stop: ${name}.`);
      }
    }
    return;
  }
  if (action === "restart-hermes") {
    control(["restart", "pythia-agent-hermes.service"]);
    return;
  }
  throw new Error(`Unsupported service action: ${action}`);
}

export function removeUnits(paths) {
  for (const name of UNIT_NAMES) {
    const path = join(paths.unitRoot, basename(name));
    if (!existsSync(path)) continue;
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Refusing to remove symlinked user unit: ${path}`);
    }
    rmSync(path);
  }
}
