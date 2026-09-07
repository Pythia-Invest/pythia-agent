import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
export const REPOSITORY = resolve(dirname(SCRIPT), "../..");
export const QUALIFICATION_PARENT = join(
  REPOSITORY,
  ".local/qualification/t08",
);
export const CONTEXT_TOOL = "pythia_qualification_context_probe";
export const CONTEXT_PASS_TOOLSET = "pythia-sec";
export const CONTEXT_FAIL_TOOLSET = "pythia-qualification-context-fail";
export const WORKSPACE_CANARY = "PYTHIA_T08_WORKSPACE_CONTEXT_CANARY";
export const BUILDER_CANARY = "PYTHIA_T08_BUILDER_CONTEXT_CANARY";
export const SETTINGS_MUTATION_TIMEOUT_MS =
  120_000 + 3 * 30_000 + 40 * 125 + 5_000;

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.environment ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function exactRegularFile(path) {
  if (!existsSync(path))
    throw new Error(`Required qualification file is missing: ${path}`);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Qualification input must be a regular file: ${path}`);
  }
}

export function exactExecutable(path) {
  if (!existsSync(path))
    throw new Error(`Required qualification executable is missing: ${path}`);
  const target = lstatSync(path).isSymbolicLink() ? realpathSync(path) : path;
  const info = lstatSync(target);
  if (!info.isFile() || (info.mode & 0o111) === 0) {
    throw new Error(`Qualification executable is not a runnable file: ${path}`);
  }
}

function artifact(dependency, kind) {
  const match = dependency.artifacts.find((entry) => entry.kind === kind);
  if (!match)
    throw new Error(
      `Pinned ${dependency.identity} artifact ${kind} is missing.`,
    );
  return match;
}

function verifyArtifact(path, expected) {
  exactRegularFile(path);
  const actual = sha256(path);
  if (actual !== expected) {
    throw new Error(
      `Qualification cache hash mismatch at ${path}: expected ${expected}, got ${actual}.`,
    );
  }
  return actual;
}

function pythonDistribution(python, distribution, module) {
  exactExecutable(python);
  return JSON.parse(
    run(python, [
      "-c",
      "import importlib,importlib.metadata,json,sys; d=importlib.metadata.distribution(sys.argv[1]); m=importlib.import_module(sys.argv[2]); print(json.dumps({'version':d.version,'module':m.__file__,'direct_url':d.read_text('direct_url.json')}))",
      distribution,
      module,
    ]),
  );
}

function cacheInput(value) {
  if (!value || typeof value !== "object") {
    throw new Error("An explicit qualification cache input is required.");
  }
  const files = Object.fromEntries(
    Object.entries(value).map(([name, path]) => [name, resolve(String(path))]),
  );
  for (const required of [
    "hermesArchive",
    "hermesPython",
    "hermesRuntimePrefix",
    "hermesSource",
    "uvBinary",
    "basicMemoryArchive",
    "basicMemoryWheel",
    "basicMemoryPython",
    "basicMemoryRuntimePrefix",
    "edgarArchive",
    "edgarWheel",
    "edgarPython",
    "edgarRuntimePrefix",
    "eodhdArchive",
    "eodhdSourceArchive",
    "eodhdPackage",
  ]) {
    if (!files[required])
      throw new Error(`Qualification cache input lacks ${required}.`);
  }
  return files;
}

export function verifyQualificationCache(input, repository = REPOSITORY) {
  const root = resolve(repository);
  const versions = JSON.parse(
    readFileSync(join(root, "runtime/versions.json"), "utf8"),
  );
  const dependencies = versions.dependencies;
  const files = cacheInput(input);
  exactExecutable(files.uvBinary);
  const uvVersion = run(files.uvBinary, ["--version"]);
  if (!/^uv 0\.9\.28(?:\s|$)/u.test(uvVersion)) {
    throw new Error(`Qualified uv is ${uvVersion}; expected uv 0.9.28.`);
  }
  for (const path of [
    files.hermesSource,
    files.hermesRuntimePrefix,
    files.basicMemoryRuntimePrefix,
    files.edgarRuntimePrefix,
    ...(files.uvCache ? [files.uvCache] : []),
  ]) {
    if (
      !existsSync(path) ||
      !lstatSync(path).isDirectory() ||
      lstatSync(path).isSymbolicLink()
    ) {
      throw new Error(
        `Qualification cache directory is missing or unsafe: ${path}`,
      );
    }
  }

  const hashes = {
    uvBinary: sha256(realpathSync(files.uvBinary)),
    hermesArchive: verifyArtifact(
      files.hermesArchive,
      artifact(dependencies.hermes_agent, "github-tag-source-tarball").sha256,
    ),
    basicMemoryArchive: verifyArtifact(
      files.basicMemoryArchive,
      artifact(dependencies.basic_memory, "github-commit-source-tarball")
        .sha256,
    ),
    basicMemoryWheel: verifyArtifact(
      files.basicMemoryWheel,
      artifact(dependencies.basic_memory, "pypi-wheel").sha256,
    ),
    edgarArchive: verifyArtifact(
      files.edgarArchive,
      artifact(dependencies.edgartools, "pypi-sdist").sha256,
    ),
    edgarWheel: verifyArtifact(
      files.edgarWheel,
      artifact(dependencies.edgartools, "pypi-wheel").sha256,
    ),
    eodhdArchive: verifyArtifact(
      files.eodhdArchive,
      artifact(dependencies.eodhd, "npm-tarball").sha256,
    ),
    eodhdSourceArchive: verifyArtifact(
      files.eodhdSourceArchive,
      artifact(dependencies.eodhd, "github-published-commit-source-tarball")
        .sha256,
    ),
  };
  exactRegularFile(files.eodhdPackage);
  const installedDetails = {
    hermes_agent: pythonDistribution(
      files.hermesPython,
      "hermes-agent",
      "hermes_cli",
    ),
    basic_memory: pythonDistribution(
      files.basicMemoryPython,
      "basic-memory",
      "basic_memory",
    ),
    edgartools: pythonDistribution(files.edgarPython, "edgartools", "edgar"),
  };
  const installed = {
    hermes_agent: installedDetails.hermes_agent.version,
    basic_memory: installedDetails.basic_memory.version,
    edgartools: installedDetails.edgartools.version,
    eodhd: JSON.parse(readFileSync(files.eodhdPackage, "utf8")).version,
  };
  for (const [name, version] of Object.entries(installed)) {
    if (version !== dependencies[name].package_version) {
      throw new Error(
        `Cached ${name} version is ${version}; expected ${dependencies[name].package_version}.`,
      );
    }
  }
  const expectedOrigins = {
    hermes_agent: files.hermesSource,
    basic_memory: files.basicMemoryRuntimePrefix,
    edgartools: files.edgarRuntimePrefix,
  };
  for (const [name, expected] of Object.entries(expectedOrigins)) {
    const modulePath = resolve(installedDetails[name].module);
    if (!modulePath.startsWith(`${resolve(expected)}${sep}`)) {
      throw new Error(
        `Cached ${name} imports from unexpected source ${modulePath}.`,
      );
    }
  }
  const basicMemoryDirect = JSON.parse(
    installedDetails.basic_memory.direct_url ?? "null",
  );
  const edgarDirect = JSON.parse(
    installedDetails.edgartools.direct_url ?? "null",
  );
  const hermesDirect = JSON.parse(
    installedDetails.hermes_agent.direct_url ?? "null",
  );
  if (
    resolve(fileURLToPath(basicMemoryDirect?.url ?? "file:///missing")) !==
      resolve(files.basicMemoryWheel) ||
    resolve(fileURLToPath(edgarDirect?.url ?? "file:///missing")) !==
      resolve(files.edgarWheel) ||
    resolve(fileURLToPath(hermesDirect?.url ?? "file:///missing")) !==
      resolve(files.hermesSource) ||
    hermesDirect?.dir_info?.editable !== true
  ) {
    throw new Error(
      "Cached Python installation origin does not match its exact qualified input.",
    );
  }
  return {
    files,
    hashes,
    installed,
    installed_origins: {
      basic_memory: installedDetails.basic_memory.module,
      edgartools: installedDetails.edgartools.module,
      hermes_agent: installedDetails.hermes_agent.module,
    },
    pins: {
      hermes_commit: dependencies.hermes_agent.commit,
      basic_memory_commit: dependencies.basic_memory.commit,
      eodhd_commit: dependencies.eodhd.commit,
    },
    toolchain: { uv: uvVersion },
    non_pinned_source_checkouts_used_for_activation: false,
  };
}

export function runNativeContractProbe(input, repository = REPOSITORY) {
  const cache = verifyQualificationCache(input, repository);
  const output = run(
    cache.files.hermesPython,
    [
      join(repository, "tooling/qualification/native-hermes-skills.py"),
      "--hermes-source",
      cache.files.hermesSource,
      "--hermes-source-archive",
      cache.files.hermesArchive,
      "--hermes-runtime-prefix",
      cache.files.hermesRuntimePrefix,
      "--repository",
      repository,
    ],
    { cwd: repository },
  );
  const result = JSON.parse(output);
  if (
    result.hermes_commit !== cache.pins.hermes_commit ||
    result.provider_or_model_call !== false ||
    result.external_network_required !== false ||
    result.isolated_profile_cleanup !== true
  ) {
    throw new Error(
      "The pinned native consumer probe returned an incompatible result.",
    );
  }
  return result;
}

export function git(repository, args) {
  return run(
    "git",
    ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args],
    {
      cwd: repository,
      environment: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_DATE: "2026-09-05T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-09-05T00:00:00Z",
      },
    },
  );
}

export function qualificationRoot(value) {
  const root = resolve(value);
  if (!root.startsWith(`${QUALIFICATION_PARENT}${sep}`)) {
    throw new Error(
      `Qualification root must be below ${QUALIFICATION_PARENT}.`,
    );
  }
  return root;
}
