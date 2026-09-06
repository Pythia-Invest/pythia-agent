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
import {
  assertNoSymlink,
  atomicWriteJson,
  copyPrivateFile,
  ensurePrivateDirectory,
  readJsonIfPresent,
} from "./files.mjs";

export function run(command, args, options = {}) {
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

export function assertCheckout(paths) {
  if (!paths.checkout) throw new Error("PYTHIA_CHECKOUT is required.");
  const root = run("git", ["rev-parse", "--show-toplevel"], {
    cwd: paths.checkout,
  });
  if (resolve(root) !== resolve(paths.checkout)) {
    throw new Error("The installed checkout path is not a Git root.");
  }
}

export function ensureRoots(paths) {
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

export function persistChannel(paths, channel) {
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

export function installTrustRoot(paths) {
  copyPrivateFile(
    join(paths.checkout, "release", "allowed_signers"),
    paths.allowedSigners,
  );
}

export function copyCommand(paths) {
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

export function dependencyEnvironment(
  paths,
  executables,
  environment = process.env,
) {
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
