import { homedir } from "node:os";
import { join, resolve } from "node:path";

function root(environment, explicit, xdg, fallback) {
  return resolve(
    environment[explicit] ??
      environment[xdg] ??
      join(environment.HOME ?? homedir(), fallback),
  );
}

export function resolveInstallPaths(environment = process.env) {
  const configBase = root(
    environment,
    "PYTHIA_INSTALL_CONFIG_HOME",
    "XDG_CONFIG_HOME",
    ".config",
  );
  const stateBase = root(
    environment,
    "PYTHIA_INSTALL_STATE_HOME",
    "XDG_STATE_HOME",
    join(".local", "state"),
  );
  const dataBase = root(
    environment,
    "PYTHIA_INSTALL_DATA_HOME",
    "XDG_DATA_HOME",
    join(".local", "share"),
  );
  const cacheBase = root(
    environment,
    "PYTHIA_INSTALL_CACHE_HOME",
    "XDG_CACHE_HOME",
    ".cache",
  );
  const binBase = resolve(
    environment.PYTHIA_INSTALL_BIN_HOME ??
      join(environment.HOME ?? homedir(), ".local", "bin"),
  );
  const unitBase = resolve(
    environment.PYTHIA_INSTALL_SYSTEMD_HOME ??
      join(configBase, "systemd", "user"),
  );
  const configRoot = join(configBase, "pythia");
  const stateRoot = join(stateBase, "pythia");
  const dataRoot = join(dataBase, "pythia");
  const cacheRoot = join(cacheBase, "pythia");
  const runtimeRoot = join(dataRoot, "runtime");
  const hermesRoot = join(configRoot, "hermes");
  const profile = "pythia";
  const profileRoot = join(hermesRoot, "profiles", profile);
  const checkout = environment.PYTHIA_CHECKOUT
    ? resolve(environment.PYTHIA_CHECKOUT)
    : null;

  return {
    id: "production",
    profile,
    ports: { hermes: 8645, memory: 8643, desk: 8644 },
    checkout,
    repositoryRoot: checkout,
    configRoot,
    stateRoot,
    dataRoot,
    cacheRoot,
    runtimeRoot,
    hermesRoot,
    profileRoot,
    basicMemoryConfig: join(configRoot, "basic-memory", "production"),
    basicMemoryCache: join(cacheRoot, "basic-memory"),
    workspace: join(dataRoot, "workspace"),
    knowledge: join(dataRoot, "knowledge"),
    edgarData: join(dataRoot, "edgar"),
    edgarCache: join(cacheRoot, "edgar"),
    processRoot: join(stateRoot, "processes"),
    receipt: join(stateRoot, "processes", "services.json"),
    hermesRestartRequest: join(stateRoot, "processes", "restart-hermes.json"),
    profileInitialization: join(stateRoot, "profile-initialization.json"),
    runtimeReceipt: join(stateRoot, "runtime.json"),
    releaseFile: join(configRoot, "release.json"),
    installFile: join(stateRoot, "installation.json"),
    lifecycleLock: join(stateRoot, "lifecycle.lock"),
    transactionRoot: join(stateRoot, "transactions"),
    trustRoot: join(stateRoot, "release-trust"),
    allowedSigners: join(stateRoot, "release-trust", "allowed_signers"),
    serviceEnvironment: join(configRoot, "service.environment"),
    serviceEnvironments: {
      hermes: join(configRoot, "service-hermes.environment"),
      basicMemory: join(configRoot, "service-basic-memory.environment"),
      desk: join(configRoot, "service-desk.environment"),
    },
    serviceLauncher: checkout
      ? join(checkout, "scripts", "install", "service-launch.py")
      : null,
    unitRoot: unitBase,
    binRoot: binBase,
    installedCommand: join(binBase, "pythia"),
    fetchCache: join(cacheRoot, "downloads"),
    hermesSource: join(
      runtimeRoot,
      "hermes",
      "29112bef099274229cadff79cdff7bf7b99c4b77",
    ),
    managedRoot: checkout ? join(checkout, "runtime", "managed") : null,
    managedPythonSource: checkout
      ? join(checkout, "runtime", "managed", "python")
      : null,
    managedPython: join(runtimeRoot, "managed-python"),
    managedPlugin: checkout
      ? join(checkout, "runtime", "managed", "plugin")
      : null,
    managedSkills: checkout
      ? join(checkout, "runtime", "managed", "skills")
      : null,
    testRoot: join(stateRoot, "tests"),
  };
}

export function publicPathSummary(paths) {
  return {
    checkout: paths.checkout,
    config: paths.configRoot,
    state: paths.stateRoot,
    data: paths.dataRoot,
    runtime: paths.runtimeRoot,
    profile: paths.profile,
    ports: paths.ports,
    desk_url: `http://127.0.0.1:${paths.ports.desk}`,
  };
}
