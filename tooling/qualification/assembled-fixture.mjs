import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import { assertHermesRuntimePath } from "../../scripts/dev/runtime.mjs";
import {
  copySourceSnapshot,
  directoryManifest,
  sourceManifest,
} from "../source-snapshot.mjs";
import {
  BUILDER_CANARY,
  CONTEXT_FAIL_TOOLSET,
  CONTEXT_PASS_TOOLSET,
  CONTEXT_TOOL,
  REPOSITORY,
  WORKSPACE_CANARY,
  exactRegularFile,
  git,
  qualificationRoot,
  sha256,
  verifyQualificationCache,
} from "./assembled-cache.mjs";

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

export function qualificationProcessEnvironment(stack) {
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

export function fixture(rootValue) {
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
