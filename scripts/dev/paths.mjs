import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

function envRoot(environment, explicit, xdg, fallback) {
  return resolve(
    environment[explicit] ??
      environment[xdg] ??
      join(environment.HOME ?? homedir(), fallback),
  );
}

export function resolveRepositoryRoot(
  cwd = process.cwd(),
  environment = process.env,
) {
  const explicit = environment.PYTHIA_DEV_REPO_ROOT;
  const candidate = explicit
    ? resolve(explicit)
    : execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
      }).trim();
  if (!existsSync(candidate)) {
    throw new Error(`Repository root does not exist: ${candidate}`);
  }
  return realpathSync(candidate);
}

export function stackIdentity(repositoryRoot) {
  const digest = createHash("sha256").update(repositoryRoot).digest("hex");
  const suffix = digest.slice(0, 12);
  const portSlot = Number.parseInt(digest.slice(12, 20), 16) % 7000;
  const firstPort = 22000 + portSlot * 3;
  return {
    id: `dev-${suffix}`,
    profile: `pythia-${suffix}`,
    ports: {
      hermes: firstPort,
      memory: firstPort + 1,
      desk: firstPort + 2,
    },
  };
}

export function resolveStackPaths(options = {}) {
  const environment = options.environment ?? process.env;
  const repositoryRoot = resolveRepositoryRoot(options.cwd, environment);
  const identity = stackIdentity(repositoryRoot);
  const configBase = envRoot(
    environment,
    "PYTHIA_DEV_CONFIG_HOME",
    "XDG_CONFIG_HOME",
    ".config",
  );
  const stateBase = envRoot(
    environment,
    "PYTHIA_DEV_STATE_HOME",
    "XDG_STATE_HOME",
    join(".local", "state"),
  );
  const dataBase = envRoot(
    environment,
    "PYTHIA_DEV_DATA_HOME",
    "XDG_DATA_HOME",
    join(".local", "share"),
  );
  const cacheBase = envRoot(
    environment,
    "PYTHIA_DEV_CACHE_HOME",
    "XDG_CACHE_HOME",
    ".cache",
  );
  const configRoot = join(configBase, "pythia");
  const stateRoot = join(stateBase, "pythia", "dev", identity.id);
  const dataRoot = join(dataBase, "pythia", "dev", identity.id);
  const cacheRoot = join(cacheBase, "pythia", "dev", identity.id);
  const hermesRoot = join(configRoot, "hermes");
  const profileRoot = join(hermesRoot, "profiles", identity.profile);
  const managedRoot = join(repositoryRoot, "runtime", "managed");

  return {
    ...identity,
    repositoryRoot,
    configRoot,
    stateRoot,
    dataRoot,
    cacheRoot,
    hermesRoot,
    profileRoot,
    basicMemoryConfig: join(configRoot, "basic-memory", identity.id),
    basicMemoryCache: join(cacheRoot, "basic-memory"),
    edgarData: join(dataRoot, "edgar"),
    edgarCache: join(cacheRoot, "edgar"),
    workspace: join(dataRoot, "workspace"),
    knowledge: join(dataRoot, "knowledge"),
    processRoot: join(stateRoot, "processes"),
    receipt: join(stateRoot, "processes", "foreground.json"),
    preparationAdmission: join(stateRoot, "processes", "preparation.json"),
    hermesRestartRequest: join(stateRoot, "processes", "restart-hermes.json"),
    profileInitialization: join(stateRoot, "profile-initialization.json"),
    runtimeReceipt: join(stateRoot, "runtime.json"),
    testRoot: join(stateRoot, "tests"),
    fetchCache: join(cacheRoot, "downloads"),
    hermesSource: join(cacheRoot, "hermes-source"),
    managedRoot,
    managedPython: join(managedRoot, "python"),
    managedPlugin: join(managedRoot, "plugin"),
    managedSkills: join(managedRoot, "skills"),
  };
}

export function isWithin(parent, child) {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  return (
    normalizedChild === normalizedParent ||
    (dirname(`${normalizedChild}/`) !== normalizedChild &&
      normalizedChild.startsWith(`${normalizedParent}/`))
  );
}
