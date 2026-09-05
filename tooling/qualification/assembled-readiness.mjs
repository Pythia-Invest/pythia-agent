import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import { assertHermesRuntimePath } from "../../scripts/dev/runtime.mjs";
import {
  copySourceSnapshot,
  directoryManifest,
  sourceManifest,
} from "../source-snapshot.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const REPOSITORY = resolve(dirname(SCRIPT), "../..");
const QUALIFICATION_PARENT = join(REPOSITORY, ".local/qualification/t08");
const CONTEXT_TOOL = "pythia_qualification_context_probe";
const CONTEXT_PASS_TOOLSET = "pythia-sec";
const CONTEXT_FAIL_TOOLSET = "pythia-qualification-context-fail";
const WORKSPACE_CANARY = "PYTHIA_T08_WORKSPACE_CONTEXT_CANARY";
const BUILDER_CANARY = "PYTHIA_T08_BUILDER_CONTEXT_CANARY";
export const SETTINGS_MUTATION_TIMEOUT_MS =
  120_000 + 3 * 30_000 + 40 * 125 + 5_000;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.environment ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function exactRegularFile(path) {
  if (!existsSync(path))
    throw new Error(`Required qualification file is missing: ${path}`);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Qualification input must be a regular file: ${path}`);
  }
}

function exactExecutable(path) {
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

function git(repository, args) {
  return run("git", args, {
    cwd: repository,
    environment: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_DATE: "2026-09-05T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-09-05T00:00:00Z",
    },
  });
}

function qualificationRoot(value) {
  const root = resolve(value);
  if (!root.startsWith(`${QUALIFICATION_PARENT}${sep}`)) {
    throw new Error(
      `Qualification root must be below ${QUALIFICATION_PARENT}.`,
    );
  }
  return root;
}

function stackEnvironment(root, worktree, configHome, cache) {
  const owners = join(root, "owners");
  const environment = {
    HOME: join(owners, "home"),
    PYTHIA_DEV_REPO_ROOT: worktree,
    PYTHIA_DEV_CONFIG_HOME: configHome,
    PYTHIA_DEV_STATE_HOME: join(owners, "state"),
    PYTHIA_DEV_DATA_HOME: join(owners, "data"),
    PYTHIA_DEV_CACHE_HOME: join(owners, "cache"),
    XDG_CONFIG_HOME: join(owners, "xdg-config"),
    XDG_STATE_HOME: join(owners, "xdg-state"),
    XDG_DATA_HOME: join(owners, "xdg-data"),
    XDG_CACHE_HOME: join(owners, "xdg-cache"),
    npm_config_store_dir: join(REPOSITORY, ".pnpm-store"),
    COREPACK_HOME: join(owners, "corepack"),
    ...qualificationCacheEnvironment(cache?.files),
  };
  return environment;
}

export function qualificationCacheEnvironment(
  files,
  hostPath = process.env.PATH ?? "",
) {
  if (!files) return {};
  return {
    ...(files.uvCache ? { UV_CACHE_DIR: files.uvCache } : {}),
    ...(files.uvBinary
      ? { PATH: `${dirname(files.uvBinary)}:${hostPath}` }
      : {}),
  };
}

function qualificationProcessEnvironment(stack) {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    CI: "1",
    NO_COLOR: "1",
    ...stack.environment,
  };
}

export function prepareAssembledFixture(rootValue, options = {}) {
  const root = qualificationRoot(rootValue);
  if (existsSync(root))
    throw new Error(`Qualification root already exists: ${root}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let shortOwner;
  try {
    const repository = resolve(options.repository ?? REPOSITORY);
    const cache = options.cacheInput
      ? verifyQualificationCache(options.cacheInput, repository)
      : null;
    const source = join(root, "source");
    copySourceSnapshot(repository, source);
    git(source, ["init", "--quiet", "--initial-branch=main"]);
    git(source, ["config", "user.name", "Pythia assembled qualification"]);
    git(source, ["config", "user.email", "qualification@invalid.example"]);
    git(source, ["config", "commit.gpgSign", "false"]);
    git(source, ["config", "core.hooksPath", "/dev/null"]);
    git(source, ["add", "-A"]);
    git(source, [
      "commit",
      "--quiet",
      "-m",
      "exact local qualification source",
    ]);
    const revision = git(source, ["rev-parse", "HEAD"]);
    const worktreeRoot = join(root, "worktrees");
    mkdirSync(worktreeRoot, { recursive: true, mode: 0o700 });
    shortOwner = mkdtempSync("/tmp/pq-");
    const configHome = join(shortOwner, "c");
    const stacks = {};
    for (const name of ["one", "two"]) {
      const worktree = join(worktreeRoot, name);
      git(source, [
        "worktree",
        "add",
        "--quiet",
        "--detach",
        worktree,
        revision,
      ]);
      const environment = stackEnvironment(root, worktree, configHome, cache);
      const paths = resolveStackPaths({ environment });
      assertHermesRuntimePath(paths);
      if (cache) {
        mkdirSync(paths.fetchCache, { recursive: true, mode: 0o700 });
        const stagedArchive = join(
          paths.fetchCache,
          `hermes-${cache.pins.hermes_commit}.tar.gz`,
        );
        copyFileSync(cache.files.hermesArchive, stagedArchive);
        if (sha256(stagedArchive) !== cache.hashes.hermesArchive) {
          throw new Error(`Staged Hermes archive changed for stack ${name}.`);
        }
      }
      stacks[name] = {
        environment,
        id: paths.id,
        native_session_id: randomUUID(),
        profile: paths.profile,
        ports: paths.ports,
        paths: {
          configRoot: paths.configRoot,
          dataRoot: paths.dataRoot,
          hermesRoot: paths.hermesRoot,
          hermesSource: paths.hermesSource,
          knowledge: paths.knowledge,
          profileRoot: paths.profileRoot,
          receipt: paths.receipt,
          stateRoot: paths.stateRoot,
          workspace: paths.workspace,
        },
        worktree,
      };
    }
    const exact = sourceManifest(repository);
    for (const stack of Object.values(stacks)) {
      if (directoryManifest(stack.worktree).digest !== exact.digest) {
        throw new Error(
          `Worktree ${stack.id} does not match exact current source.`,
        );
      }
    }
    const receipt = {
      schema_version: 1,
      created_source_commit: "disposable-exact-source-only",
      execution_environment: "allowlisted-replacement-not-inherited-merge",
      provider_or_model_call: false,
      publication_or_target_git_mutation: false,
      qualification_cache: cache
        ? "explicit-verified-input"
        : "normal-public-pin-hydration",
      revision,
      source_manifest: exact,
      shared_configuration_owner: join(configHome, "pythia"),
      short_configuration_owner: shortOwner,
      stacks,
    };
    writeFileSync(
      join(root, "fixture.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    return receipt;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    if (shortOwner) rmSync(shortOwner, { recursive: true, force: true });
    throw error;
  }
}

function fixture(rootValue) {
  const root = qualificationRoot(rootValue);
  const path = join(root, "fixture.json");
  exactRegularFile(path);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    value.schema_version !== 1 ||
    value.created_source_commit !== "disposable-exact-source-only"
  ) {
    throw new Error(`Qualification fixture receipt is invalid: ${path}`);
  }
  return { root, value };
}

const CONTEXT_PROBE_SOURCE = `

# BEGIN PYTHIA T08 DISPOSABLE CONTEXT PROBE
_pythia_t08_base_register = register

def _pythia_t08_context_probe(_args, **_kwargs):
    return json.dumps({"provider_or_model_call": False})

def register(ctx: Any) -> None:
    _pythia_t08_base_register(ctx)
    from agent.prompt_builder import build_context_files_prompt
    from agent.runtime_cwd import resolve_agent_cwd, resolve_context_cwd
    workspace = Path(os.environ["PYTHIA_WORKSPACE"]).resolve()
    agent_cwd = resolve_agent_cwd()
    context_cwd = resolve_context_cwd()
    context = build_context_files_prompt(cwd=str(context_cwd), skip_soul=True)
    passed = (
        agent_cwd == workspace
        and context_cwd == workspace
        and "${WORKSPACE_CANARY}" in context
        and "${BUILDER_CANARY}" not in context
    )
    ctx.register_tool(
        name="${CONTEXT_TOOL}",
        toolset="${CONTEXT_PASS_TOOLSET}" if passed else "${CONTEXT_FAIL_TOOLSET}",
        schema={
            "name": "${CONTEXT_TOOL}",
            "description": "Provider-free native cwd/context witness",
            "parameters": {"type": "object", "additionalProperties": False},
        },
        handler=_pythia_t08_context_probe,
        description="Provider-free native cwd/context witness",
    )
# END PYTHIA T08 DISPOSABLE CONTEXT PROBE
`;

export function instrumentContextProbe(rootValue, stackName = "one") {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  const builder = join(stack.worktree, "AGENTS.md");
  const workspace = join(stack.paths.workspace, "AGENTS.md");
  const plugin = join(stack.worktree, "runtime/managed/plugin/__init__.py");
  const manifest = join(stack.worktree, "runtime/managed/plugin/plugin.yaml");
  for (const path of [builder, plugin, manifest]) exactRegularFile(path);
  if (!existsSync(workspace)) {
    mkdirSync(dirname(workspace), { recursive: true, mode: 0o700 });
    copyFileSync(
      join(stack.worktree, "runtime/seeds/workspace/AGENTS.md"),
      workspace,
    );
  }
  exactRegularFile(workspace);
  for (const [path, marker] of [
    [builder, BUILDER_CANARY],
    [workspace, WORKSPACE_CANARY],
  ]) {
    const current = readFileSync(path, "utf8");
    if (!current.includes(marker)) appendFileSync(path, `\n${marker}\n`);
  }
  const manifestText = readFileSync(manifest, "utf8");
  if (!manifestText.includes(CONTEXT_TOOL)) {
    writeFileSync(
      manifest,
      manifestText.replace(
        "  - pythia_eod_prices\n",
        `  - pythia_eod_prices\n  - ${CONTEXT_TOOL}\n`,
      ),
    );
  }
  const pluginText = readFileSync(plugin, "utf8");
  if (!pluginText.includes("BEGIN PYTHIA T08 DISPOSABLE CONTEXT PROBE")) {
    appendFileSync(plugin, CONTEXT_PROBE_SOURCE);
  }
  return {
    builder_canary: BUILDER_CANARY,
    context_tool: CONTEXT_TOOL,
    expected_toolset: CONTEXT_PASS_TOOLSET,
    provider_or_model_call: false,
    stack: stackName,
    workspace_canary: WORKSPACE_CANARY,
  };
}

export function requestJson({
  port,
  path,
  method = "GET",
  headers = {},
  body,
  timeoutMs = 5_000,
}) {
  return new Promise((resolvePromise, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path, method, headers },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch (error) {
            reject(error);
            return;
          }
          if ((response.statusCode ?? 500) >= 400) {
            reject(
              new Error(
                `${method} ${path} returned ${response.statusCode}: ${text}`,
              ),
            );
            return;
          }
          resolvePromise({
            body: parsed,
            headers: response.headers,
            status: response.statusCode,
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error(`${method} ${path} timed out.`)),
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function privateStateDigests(stack) {
  const candidates = {
    profile_config: join(stack.paths.profileRoot, "config.yaml"),
    root_auth: join(stack.paths.hermesRoot, "auth.json"),
    secrets: join(stack.paths.configRoot, "secrets.json"),
    workspace_context: join(stack.paths.workspace, "AGENTS.md"),
    workspace_note: join(stack.paths.workspace, "qualification-note.md"),
    knowledge_note: join(stack.paths.knowledge, "qualification-note.md"),
  };
  return Object.fromEntries(
    Object.entries(candidates).map(([name, path]) => [
      name,
      existsSync(path) ? sha256(path) : null,
    ]),
  );
}

const NATIVE_SESSION_SCRIPT = `
import json
import sys
from pathlib import Path
from hermes_state import SessionDB

mode, session_id, workspace = sys.argv[1:]
db = SessionDB(Path.cwd() / "state.db")
try:
    if mode == "seed":
        result = db.import_sessions([{
            "id": session_id,
            "source": "cli",
            "title": "Pythia T08 synthetic native session",
            "cwd": workspace,
            "git_repo_root": workspace,
            "messages": [{
                "role": "user",
                "content": "Provider-free synthetic native session state",
            }],
        }])
        if not result.get("ok"):
            raise RuntimeError(f"native session import failed: {result}")
    session = db.export_session(session_id)
    if session is None:
        raise RuntimeError(f"native session {session_id!r} is missing")
    selected = {
        "id": session["id"],
        "source": session["source"],
        "title": session["title"],
        "cwd": session["cwd"],
        "git_repo_root": session["git_repo_root"],
        "messages": [
            {"role": item["role"], "content": item["content"]}
            for item in session.get("messages", [])
        ],
    }
    print(json.dumps(selected, sort_keys=True))
finally:
    db.close()
`;

function nativeSession(stack, mode) {
  const python = join(stack.paths.hermesSource, ".venv/bin/python");
  exactExecutable(python);
  mkdirSync(stack.paths.profileRoot, { recursive: true, mode: 0o700 });
  const selected = JSON.parse(
    run(
      python,
      [
        "-c",
        NATIVE_SESSION_SCRIPT,
        mode,
        stack.native_session_id,
        stack.paths.workspace,
      ],
      {
        cwd: stack.paths.profileRoot,
        environment: {
          ...qualificationProcessEnvironment(stack),
          HERMES_HOME: stack.paths.profileRoot,
          PYTHONPATH: stack.paths.hermesSource,
        },
      },
    ),
  );
  return {
    id: stack.native_session_id,
    selected,
    sha256: createHash("sha256").update(JSON.stringify(selected)).digest("hex"),
    store: join(stack.paths.profileRoot, "state.db"),
  };
}

export function seedNativeSession(rootValue, stackName = "one") {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  return {
    native_session: nativeSession(stack, "seed"),
    provider_or_model_call: false,
    stack: stackName,
  };
}

async function deskSession(stack) {
  const origin = `http://127.0.0.1:${stack.ports.desk}`;
  const common = { Host: `127.0.0.1:${stack.ports.desk}`, Origin: origin };
  const bootstrap = await requestJson({
    port: stack.ports.desk,
    path: "/api/browser-session",
    headers: common,
  });
  const csrf = bootstrap.body.csrf_token;
  const rawCookie = bootstrap.headers["set-cookie"]?.[0] ?? "";
  const cookie = rawCookie.split(";", 1)[0];
  if (!csrf || !cookie)
    throw new Error("Desk did not issue its browser session and CSRF token.");
  return { common, cookie, csrf };
}

export async function observeAssembledStack(rootValue, stackName = "one") {
  const { value } = fixture(rootValue);
  const stack = value.stacks[stackName];
  if (!stack) throw new Error(`Unknown qualification stack: ${stackName}`);
  const secretsPath = join(stack.paths.configRoot, "secrets.json");
  exactRegularFile(secretsPath);
  const apiKey = JSON.parse(readFileSync(secretsPath, "utf8")).hermes_api_key;
  if (typeof apiKey !== "string" || apiKey.length < 16) {
    throw new Error(
      "Synthetic Hermes API key is missing from the qualification owner.",
    );
  }
  const toolsets = await requestJson({
    port: stack.ports.hermes,
    path: "/v1/toolsets",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const skills = await requestJson({
    port: stack.ports.hermes,
    path: "/v1/skills",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const session = await deskSession(stack);
  const settings = await requestJson({
    port: stack.ports.desk,
    path: "/api/settings",
    headers: { ...session.common, Cookie: session.cookie },
  });
  const rows = toolsets.body.data ?? [];
  return {
    context_probe_failed: rows.some(
      (row) =>
        row.name === CONTEXT_FAIL_TOOLSET && row.tools?.includes(CONTEXT_TOOL),
    ),
    context_probe_passed: rows.some(
      (row) =>
        row.name === CONTEXT_PASS_TOOLSET && row.tools?.includes(CONTEXT_TOOL),
    ),
    desk_admission: "normal-loopback-origin-cookie",
    native_skills: (skills.body.data ?? []).map((entry) => entry.name).sort(),
    native_session: nativeSession(stack, "read"),
    private_state_sha256: privateStateDigests(stack),
    provider_or_model_call: false,
    runtime_generation: JSON.parse(readFileSync(stack.paths.receipt, "utf8"))
      .runtime_generation,
    settings: {
      skills: settings.body.skills,
      toolsets: settings.body.toolsets,
    },
    stack: stackName,
  };
}

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
  rmSync(root, { recursive: true });
  rmSync(shortOwner, { recursive: true });
  return {
    cleaned: !existsSync(root) && !existsSync(shortOwner),
    existed: true,
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const action = process.argv[2];
  const root = option("--root");
  const stack = option("--stack") ?? "one";
  const cacheInputPath = option("--cache-input");
  const explicitCache = cacheInputPath
    ? JSON.parse(readFileSync(resolve(cacheInputPath), "utf8"))
    : null;
  let result;
  if (action === "verify-cache") {
    if (!explicitCache)
      throw new Error("verify-cache requires --cache-input PATH.");
    result = {
      cache: verifyQualificationCache(explicitCache),
      native: runNativeContractProbe(explicitCache),
    };
  } else if (action === "prepare" && root) {
    if (explicitCache) runNativeContractProbe(explicitCache);
    result = prepareAssembledFixture(root, { cacheInput: explicitCache });
  } else if (action === "instrument-context-probe" && root) {
    result = instrumentContextProbe(root, stack);
  } else if (action === "seed-state" && root) {
    result = seedSyntheticState(root, stack);
  } else if (action === "seed-native-session" && root) {
    result = seedNativeSession(root, stack);
  } else if (action === "disable-skill" && root) {
    result = await disableSyntheticSkill(root, stack);
  } else if (action === "observe" && root) {
    result = await observeAssembledStack(root, stack);
  } else if (action === "cleanup" && root) {
    result = cleanupAssembledFixture(root);
  } else {
    throw new Error(
      "Usage: assembled-readiness.mjs <verify-cache|prepare|instrument-context-probe|seed-state|seed-native-session|disable-skill|observe|cleanup> [--root PATH] [--stack one|two] [--cache-input PATH]",
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  await main();
}
