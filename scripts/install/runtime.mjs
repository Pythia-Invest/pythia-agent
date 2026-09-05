import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { bootstrapRuntime, readApiKey } from "../dev/runtime.mjs";
import {
  assertNoSymlink,
  atomicWriteJson,
  copyPrivateFile,
  ensurePrivateDirectory,
  readJsonIfPresent,
  transactionReceipt,
  writeTransaction,
} from "./files.mjs";
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.environment ?? process.env,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 600_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}${detail ? `:\n${detail}` : ""}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

function assertCheckout(paths) {
  if (!paths.checkout) throw new Error("PYTHIA_CHECKOUT is required.");
  const root = run("git", ["rev-parse", "--show-toplevel"], {
    cwd: paths.checkout,
  });
  if (resolve(root) !== resolve(paths.checkout)) {
    throw new Error("The installed checkout path is not a Git root.");
  }
}

function ensureRoots(paths) {
  for (const path of [
    paths.configRoot,
    paths.stateRoot,
    paths.dataRoot,
    paths.cacheRoot,
    paths.runtimeRoot,
    paths.hermesRoot,
    paths.basicMemoryConfig,
    paths.basicMemoryCache,
    paths.workspace,
    paths.knowledge,
    paths.edgarData,
    paths.edgarCache,
    paths.processRoot,
    paths.transactionRoot,
    paths.trustRoot,
  ]) {
    ensurePrivateDirectory(path);
  }
}

export function installedExecutables(paths, environment = process.env) {
  const node =
    environment.PYTHIA_NODE_EXECUTABLE ??
    join(paths.runtimeRoot, "node", "22.16.0", "bin", "node");
  const uv =
    environment.PYTHIA_UV_EXECUTABLE ??
    join(paths.runtimeRoot, "uv", "0.9.28", "uv");
  const python =
    environment.PYTHIA_PYTHON_EXECUTABLE ??
    run(uv, ["python", "find", "3.12.11"], {
      environment: {
        ...environment,
        UV_PYTHON_INSTALL_DIR: join(paths.runtimeRoot, "python"),
        UV_PYTHON_PREFERENCE: "only-managed",
      },
    });
  return {
    node,
    uv,
    python,
    managedPython: join(paths.managedPython, ".venv", "bin", "python"),
    hermes: join(paths.hermesSource, ".venv", "bin", "hermes"),
    basicMemory: join(paths.managedPython, ".venv", "bin", "basic-memory"),
    next: join(
      paths.checkout,
      "apps",
      "desk",
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    ),
  };
}

function persistChannel(paths, channel) {
  const current = readJsonIfPresent(paths.releaseFile);
  if (current) {
    if (current.schema_version !== 1 || current.channel !== channel) {
      throw new Error(
        `This device is already on the ${current.channel ?? "invalid"} channel. Channel changes must be explicit and are not performed by install.`,
      );
    }
    return;
  }
  atomicWriteJson(paths.releaseFile, { schema_version: 1, channel });
}

function installTrustRoot(paths) {
  copyPrivateFile(
    join(paths.checkout, "release", "allowed_signers"),
    paths.allowedSigners,
  );
}

function copyCommand(paths) {
  const source = join(paths.checkout, "bin", "pythia");
  const info = lstatSync(source);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(
      `Installed command source must be a regular file: ${source}`,
    );
  }
  mkdirSync(paths.binRoot, { recursive: true, mode: 0o755 });
  assertNoSymlink(paths.installedCommand, "Installed Pythia command");
  const temporary = `${paths.installedCommand}.${process.pid}.new`;
  rmSync(temporary, { force: true });
  try {
    copyFileSync(source, temporary);
    chmodSync(temporary, 0o755);
    renameSync(temporary, paths.installedCommand);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function buildEnvironment(environment = process.env) {
  const names = [
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "TZ",
    "CI",
    "TERM",
    "NO_COLOR",
    "FORCE_COLOR",
  ];
  return Object.fromEntries(
    names.flatMap((name) =>
      environment[name] === undefined ? [] : [[name, environment[name]]],
    ),
  );
}

function dependencyEnvironment(paths, executables, environment = process.env) {
  return {
    ...buildEnvironment(environment),
    PATH: [
      dirname(executables.node),
      dirname(executables.uv),
      dirname(executables.python),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":"),
    UV_PYTHON: executables.python,
    UV_PYTHON_INSTALL_DIR: join(paths.runtimeRoot, "python"),
    COREPACK_HOME: join(paths.runtimeRoot, "corepack"),
    XDG_CACHE_HOME: paths.cacheRoot,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function buildManagedSource(paths, executables, options = {}) {
  const environment = dependencyEnvironment(paths, executables);
  (options.runCommand ?? run)("pnpm", ["--filter", "@pythia/desk", "build"], {
    cwd: paths.checkout,
    environment,
  });
}

export function inspectInstallationSource(paths) {
  const revision = run("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: paths.checkout,
  });
  const status = run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    { cwd: paths.checkout },
  );
  let branch = null;
  try {
    branch = run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: paths.checkout,
    });
  } catch {
    // Detached HEAD is valid for an explicitly chosen preview source.
  }
  let main = null;
  try {
    main = run("git", ["rev-parse", "--verify", "refs/heads/main^{commit}"], {
      cwd: paths.checkout,
    });
  } catch {
    // A chosen preview source need not have a local main branch.
  }
  return {
    revision,
    dirty: Boolean(status),
    branch,
    update_safe: !status && branch === "main" && main === revision,
  };
}

export function assertInstallationSource(
  paths,
  channel,
  expectedRevision,
  options = {},
) {
  if (!/^[0-9a-f]{40,64}$/u.test(expectedRevision ?? "")) {
    throw new Error(
      "The verified installation revision is missing or invalid.",
    );
  }
  const source = inspectInstallationSource(paths);
  const revision = source.revision;
  if (revision !== expectedRevision) {
    throw new Error(
      "The checkout revision changed after installation preflight.",
    );
  }
  if (!options.allowLocal && source.dirty) {
    throw new Error(
      "The checkout became dirty during installation preparation.",
    );
  }
  if (options.allowLocal) {
    if (!["preview", "stable"].includes(channel)) {
      throw new Error("Install channel must be stable or preview.");
    }
  } else if (channel === "preview") {
    if (!source.update_safe) {
      throw new Error("Preview installation no longer points exactly at main.");
    }
  } else if (channel === "stable") {
    const tags = run("git", ["tag", "--points-at", "HEAD"], {
      cwd: paths.checkout,
    })
      .split(/\r?\n/u)
      .filter((tag) =>
        /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(tag),
      );
    if (tags.length !== 1) {
      throw new Error(
        "Stable installation no longer has one exact SemVer tag.",
      );
    }
    const [tag] = tags;
    const trust = join(paths.checkout, "release", "allowed_signers");
    if (
      run("git", ["cat-file", "-t", `refs/tags/${tag}`], {
        cwd: paths.checkout,
      }) !== "tag"
    ) {
      throw new Error("Stable installation tag is no longer annotated.");
    }
    run(
      "git",
      [
        "-c",
        "gpg.format=ssh",
        "-c",
        `gpg.ssh.allowedSignersFile=${trust}`,
        "verify-tag",
        `refs/tags/${tag}`,
      ],
      { cwd: paths.checkout },
    );
  } else {
    throw new Error("Install channel must be stable or preview.");
  }
  return revision;
}

export function recordInstallation(paths, channel, revision, source = {}) {
  atomicWriteJson(paths.installFile, {
    schema_version: 1,
    checkout: paths.checkout,
    channel,
    revision,
    source: {
      kind: source.kind ?? "release",
      dirty: source.dirty ?? false,
      branch: source.branch ?? null,
      update_safe: source.update_safe ?? true,
    },
    installed_at: new Date().toISOString(),
  });
}

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

export async function installDevice(paths, channel, dependencies = {}) {
  if (!["stable", "preview"].includes(channel)) {
    throw new Error("Install channel must be stable or preview.");
  }
  const expectedRevision = dependencies.expectedRevision;
  if (!/^[0-9a-f]{40,64}$/u.test(expectedRevision ?? "")) {
    throw new Error("The verified installation revision is required.");
  }
  const prepare = dependencies.prepare ?? prepareInstallation;
  const start =
    dependencies.startAndVerify ??
    ((currentPaths) =>
      startAndVerify(currentPaths, { enableAfterVerify: false }));
  const enable =
    dependencies.enable ??
    (dependencies.startAndVerify
      ? () => undefined
      : () => serviceAction("enable"));
  const linger = dependencies.ensureLinger ?? ensureLinger;
  const record = dependencies.recordInstallation ?? recordInstallation;
  const stop = dependencies.stop ?? (() => serviceAction("stop"));
  const verifySource =
    dependencies.verifySource ??
    (() =>
      assertInstallationSource(paths, channel, expectedRevision, {
        allowLocal: channel === "preview",
      }));
  const existing = readJsonIfPresent(paths.installFile);
  const interrupted = transactionReceipt(paths).value;
  if (existing) {
    const recoverable =
      interrupted?.operation === "install" &&
      interrupted.channel === channel &&
      interrupted.new_revision === expectedRevision &&
      existing.checkout === paths.checkout &&
      existing.channel === channel &&
      existing.revision === expectedRevision &&
      ["recording", "complete", "failed-stopped"].includes(interrupted.phase);
    if (!recoverable) {
      throw new Error("Pythia is already installed. Use 'pythia update'.");
    }
    try {
      await stop();
      await verifySource();
      await start(paths);
      const lingerStatus = await linger();
      await verifySource();
      writeTransaction(paths, {
        ...interrupted,
        phase: "complete",
        services: "running",
        error_code: null,
        error_message: null,
      });
      await enable();
      return {
        installed: true,
        recovered: true,
        channel,
        revision: expectedRevision,
        linger: lingerStatus,
        desk_url: `http://127.0.0.1:${paths.ports.desk}`,
      };
    } catch (error) {
      let stopConfirmed = false;
      try {
        await stop();
        stopConfirmed = true;
      } catch {
        // The receipt reports an unconfirmed stop below.
      }
      writeTransaction(paths, {
        ...interrupted,
        phase: "failed-stopped",
        services: stopConfirmed ? "stopped" : "stop-unconfirmed",
        error_code: "install_recovery_failed",
        error_message:
          error instanceof Error ? error.message : "Install recovery failed.",
      });
      throw error;
    }
  }
  const transaction = writeTransaction(paths, {
    transaction_id: `install-${Date.now()}-${process.pid}`,
    operation: "install",
    channel,
    new_revision: expectedRevision,
    phase: "preparing",
    services: "stopped",
  });
  try {
    await stop();
    const prepared = await prepare(paths, channel, expectedRevision, {
      allowLocal: channel === "preview",
    });
    if (prepared.revision !== expectedRevision) {
      throw new Error("Prepared source does not match the verified revision.");
    }
    await verifySource();
    writeTransaction(paths, {
      ...transaction,
      new_revision: prepared.revision,
      phase: "prepared",
      services: "stopped",
    });
    await start(paths);
    const lingerStatus = await linger();
    await verifySource();
    writeTransaction(paths, {
      ...transaction,
      new_revision: prepared.revision,
      phase: "recording",
      services: "running",
    });
    record(paths, channel, prepared.revision, {
      kind: channel === "preview" ? "chosen-source" : "release",
      ...prepared.source,
    });
    await dependencies.afterRecord?.();
    writeTransaction(paths, {
      ...transaction,
      new_revision: prepared.revision,
      phase: "complete",
      services: "running",
    });
    await enable();
    return {
      installed: true,
      channel,
      revision: prepared.revision,
      linger: lingerStatus,
      desk_url: `http://127.0.0.1:${paths.ports.desk}`,
    };
  } catch (error) {
    let stopConfirmed = false;
    try {
      await stop();
      stopConfirmed = true;
    } catch {
      // A failed initial start is already stopped.
    }
    writeTransaction(paths, {
      ...transaction,
      phase: "failed-stopped",
      services: stopConfirmed ? "stopped" : "stop-unconfirmed",
      error_code: "install_failed",
      error_message: error instanceof Error ? error.message : "Install failed.",
    });
    throw error;
  }
}

export async function rebuildDevice(paths, dependencies = {}) {
  const installation = readJsonIfPresent(paths.installFile);
  if (!installation || installation.checkout !== paths.checkout) {
    throw new Error("Pythia installation ownership is missing or changed.");
  }
  const source = inspectInstallationSource(paths);
  const stop = dependencies.stop ?? (() => serviceAction("stop"));
  const prepare = dependencies.prepare ?? prepareInstallation;
  const start =
    dependencies.startAndVerify ??
    ((currentPaths) =>
      startAndVerify(currentPaths, { enableAfterVerify: false }));
  const enable =
    dependencies.enable ??
    (dependencies.startAndVerify
      ? () => undefined
      : () => serviceAction("enable"));
  const record = dependencies.recordInstallation ?? recordInstallation;
  const transaction = writeTransaction(paths, {
    transaction_id: `rebuild-${Date.now()}-${process.pid}`,
    operation: "rebuild",
    channel: installation.channel,
    old_revision: installation.revision,
    new_revision: source.revision,
    phase: "stopping",
    services: "stopping",
  });
  try {
    await stop();
    writeTransaction(paths, {
      ...transaction,
      phase: "stopped",
      services: "stopped",
    });
    const prepared = await prepare(
      paths,
      installation.channel,
      source.revision,
      {
        allowLocal: true,
      },
    );
    writeTransaction(paths, {
      ...transaction,
      phase: "prepared",
      services: "stopped",
    });
    await start(paths);
    const finalSource = inspectInstallationSource(paths);
    if (finalSource.revision !== source.revision) {
      throw new Error("The chosen source revision changed during rebuild.");
    }
    record(paths, installation.channel, prepared.revision, {
      kind: "chosen-source",
      ...finalSource,
    });
    writeTransaction(paths, {
      ...transaction,
      phase: "complete",
      services: "running",
    });
    await enable();
    return { rebuilt: true, revision: prepared.revision, source: finalSource };
  } catch (error) {
    let stopped = false;
    try {
      await stop();
      stopped = true;
    } catch {
      /* receipt records uncertainty */
    }
    writeTransaction(paths, {
      ...transaction,
      phase: "failed-stopped",
      services: stopped ? "stopped" : "stop-unconfirmed",
      error_code: "rebuild_failed",
      error_message: error instanceof Error ? error.message : "Rebuild failed.",
    });
    throw error;
  }
}
