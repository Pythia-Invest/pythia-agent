import { bootstrapRuntime, readApiKey } from "../dev/runtime.mjs";
import { applyMigrations } from "../update/migrations.mjs";
import {
  installUnits,
  refreshUnitManager,
  renderUnits,
  serviceAction,
  serviceEnvironmentValues,
  verifyOwnedUnits,
  writeServiceEnvironment,
} from "./systemd.mjs";
import { verifyBasicMemoryReadiness } from "./basic-memory-readiness.mjs";
import {
  assertCheckout,
  assertInstallationSource,
  buildManagedSource,
  copyCommand,
  dependencyEnvironment,
  ensureRoots,
  inspectInstallationSource,
  installTrustRoot,
  installedExecutables,
  persistChannel,
  run,
} from "./runtime-source.mjs";

export async function prepareInstallation(
  paths,
  channel,
  expectedRevision,
  options = {},
) {
  assertCheckout(paths);
  assertInstallationSource(paths, channel, expectedRevision, options);
  ensureRoots(paths);
  persistChannel(paths, channel);
  const executables = installedExecutables(paths);
  const environment = dependencyEnvironment(paths, executables);
  const previousPath = process.env.PATH;
  const previousUvPython = process.env.UV_PYTHON;
  const previousUvInstall = process.env.UV_PYTHON_INSTALL_DIR;
  const previousCorepack = process.env.COREPACK_HOME;
  process.env.PATH = environment.PATH;
  process.env.UV_PYTHON = executables.python;
  process.env.UV_PYTHON_INSTALL_DIR = environment.UV_PYTHON_INSTALL_DIR;
  process.env.COREPACK_HOME = environment.COREPACK_HOME;
  try {
    const preview = channel === "preview" ? " --preview" : "";
    await bootstrapRuntime(paths, {
      inheritSharedModel: false,
      initializationRecoveryCommand: `./install.sh --recover-initialization${preview}`,
    });
    buildManagedSource(paths, executables);
  } finally {
    for (const [name, value] of [
      ["PATH", previousPath],
      ["UV_PYTHON", previousUvPython],
      ["UV_PYTHON_INSTALL_DIR", previousUvInstall],
      ["COREPACK_HOME", previousCorepack],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assertInstallationSource(paths, channel, expectedRevision, options);
  installTrustRoot(paths);
  copyCommand(paths);
  applyMigrations(paths);
  const apiKey = readApiKey(paths);
  writeServiceEnvironment(paths, apiKey, executables);
  installUnits(paths, renderUnits(paths, executables));
  refreshUnitManager();
  const revision = assertInstallationSource(
    paths,
    channel,
    expectedRevision,
    options,
  );
  return { executables, revision, source: inspectInstallationSource(paths) };
}

async function waitFor(url, options = {}) {
  const deadline = Date.now() + (options.timeout ?? 60_000);
  let last = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await (options.fetch ?? fetch)(url, {
        body: options.body,
        headers: options.headers,
        method: options.method,
        signal: AbortSignal.timeout(2_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (
        response.ok &&
        (!options.contentTypes ||
          options.contentTypes.some((value) => contentType.includes(value))) &&
        (!options.validate || (await options.validate(response.clone())))
      ) {
        return response;
      }
      last = response.ok
        ? `unexpected content type ${contentType || "<missing>"}`
        : `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "request failed";
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${url} did not become ready: ${last}`);
}

export async function startAndVerify(paths, options = {}) {
  const fetcher = options.fetch ?? fetch;
  const starter = options.start ?? (() => serviceAction("start"));
  await starter();
  const executables = options.executables ?? installedExecutables(paths);
  const verifyUnits = options.verifyUnits ?? verifyOwnedUnits;
  const verifyMemory =
    options.verifyBasicMemoryReadiness ?? verifyBasicMemoryReadiness;
  await verifyUnits(paths, executables, { requireEnabled: false });
  const apiKey = readApiKey(paths);
  await waitFor(`http://127.0.0.1:${paths.ports.hermes}/health`, {
    fetch: fetcher,
    headers: { Authorization: `Bearer ${apiKey}` },
    contentTypes: ["application/json"],
    validate: async (response) => {
      const value = await response.json();
      return (
        value?.status === "ok" &&
        value?.platform === "hermes-agent" &&
        value?.version === "0.21.0"
      );
    },
  });
  await verifyMemory(paths, {
    executable: executables.basicMemory,
    environment: serviceEnvironmentValues(paths, executables).basicMemory,
    fetch: fetcher,
  });
  await waitFor(`http://127.0.0.1:${paths.ports.desk}/api/health`, {
    fetch: fetcher,
    contentTypes: ["application/json"],
    validate: async (response) => {
      const value = await response.json();
      return value?.service === "pythia-desk" && value?.status === "ok";
    },
  });
  if (options.enableAfterVerify !== false) {
    await (options.enable ?? (() => serviceAction("enable")))();
  }
}

export function ensureLinger(environment = process.env) {
  const user = environment.USER;
  if (!user || !/^[a-z_][a-z0-9_-]*[$]?$/u.test(user)) {
    throw new Error("A valid USER is required to configure systemd linger.");
  }
  const current = run("loginctl", [
    "show-user",
    user,
    "--property=Linger",
    "--value",
  ]);
  if (current === "yes") return { enabled: true, changed: false };
  console.log(
    "Pythia runs continuously as your user. Enabling systemd linger lets these user services keep running after logout; it does not create a system service or grant Pythia root privileges.",
  );
  run("loginctl", ["enable-linger", user], { inherit: true });
  const verified = run("loginctl", [
    "show-user",
    user,
    "--property=Linger",
    "--value",
  ]);
  if (verified !== "yes") throw new Error("systemd linger was not enabled.");
  return { enabled: true, changed: true };
}
