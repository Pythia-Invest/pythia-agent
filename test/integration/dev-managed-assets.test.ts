import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGED_PLUGIN_FILES,
  MANAGED_PYTHON_SOURCE_FILES,
  refreshManagedPlugin,
  refreshManagedPythonSource,
  atomicWriteJson,
  readJson,
} from "../../scripts/dev/files.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import {
  ensureHermesSource,
  prepareManagedRuntime,
  recoverInterruptedProfileInitialization,
  refreshRuntimeAssets,
} from "../../scripts/dev/runtime.mjs";
import { recoverDevelopmentInitialization } from "../../scripts/dev/supervisor.mjs";
import { copySourceSnapshot } from "../../tooling/source-snapshot.mjs";

const repositoryRoot = new URL("../../", import.meta.url).pathname.replace(
  /\/$/u,
  "",
);
const temporaryRoots: string[] = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "pythia-dev-test-"));
  temporaryRoots.push(root);
  return root;
}

function environment(root: string, repo?: string) {
  const checkout = repo ?? join(root, "checkout");
  // Port identity follows the checkout, not XDG roots. Give each fixture its
  // own source path so running tests never claims an open developer stack.
  if (repo === undefined && !existsSync(checkout))
    copySourceSnapshot(repositoryRoot, checkout);
  return {
    ...process.env,
    PYTHIA_DEV_REPO_ROOT: checkout,
    PYTHIA_DEV_CONFIG_HOME: join(root, "config"),
    PYTHIA_DEV_STATE_HOME: join(root, "state"),
    PYTHIA_DEV_DATA_HOME: join(root, "data"),
    PYTHIA_DEV_CACHE_HOME: join(root, "cache"),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("managed source and runtime preparation", () => {
  it("refreshes managed plugin files without changing later native user choices", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const managedPlugin = join(root, "managed-plugin");
    const commandLog = join(root, "hermes-commands.log");
    const hermes = join(paths.hermesSource, ".venv", "bin", "hermes");
    const userConfig = `skills:
  external_dirs:
    - /user/skills
plugins:
  disabled:
    - pythia
mcp_servers:
  basic-memory:
    enabled: false
    url: http://127.0.0.1:9999/mcp
`;
    mkdirSync(managedPlugin, { recursive: true });
    writeFileSync(join(managedPlugin, "__init__.py"), "MANAGED = True\n");
    writeFileSync(join(managedPlugin, "plugin.yaml"), "name: pythia\n");
    mkdirSync(join(paths.profileRoot, "plugins", "pythia"), {
      recursive: true,
    });
    writeFileSync(join(paths.profileRoot, "config.yaml"), userConfig);
    writeFileSync(
      join(paths.profileRoot, "plugins", "pythia", "plugin.yaml"),
      "name: stale\n",
    );
    mkdirSync(join(paths.hermesSource, ".venv", "bin"), { recursive: true });
    writeFileSync(
      hermes,
      `#!/bin/sh
printf '%s\\n' "$*" >> '${commandLog}'
`,
      { mode: 0o755 },
    );
    chmodSync(hermes, 0o755);

    await refreshRuntimeAssets(
      { ...paths, managedPlugin },
      "safe-local-key-value",
    );

    expect(readFileSync(join(paths.profileRoot, "config.yaml"), "utf8")).toBe(
      userConfig,
    );
    expect(
      readFileSync(
        join(paths.profileRoot, "plugins", "pythia", "plugin.yaml"),
        "utf8",
      ),
    ).toBe("name: pythia\n");
    expect(readFileSync(commandLog, "utf8").trim()).toBe(
      `-p ${paths.profile} plugins doctor ${join(paths.profileRoot, "plugins", "pythia")} --ci`,
    );
  });

  it("recreates a tampered Hermes source cache from the verified archive", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const commit = "fixture-commit";
    const archive = join(paths.fetchCache, `hermes-${commit}.tar.gz`);
    const archiveInput = join(root, "archive-input", "hermes-fixture");
    mkdirSync(archiveInput, { recursive: true });
    mkdirSync(paths.fetchCache, { recursive: true });
    writeFileSync(
      join(archiveInput, "pyproject.toml"),
      "[project]\nname='fixture'\n",
    );
    writeFileSync(join(archiveInput, "uv.lock"), "version = 1\n");
    writeFileSync(join(archiveInput, "hermes.py"), "TRUSTED = True\n");
    mkdirSync(join(archiveInput, "package", "hermes_agent.egg-info"), {
      recursive: true,
    });
    writeFileSync(
      join(archiveInput, "package", "hermes_agent.egg-info", "PKG-INFO"),
      "source-owned metadata\n",
    );
    execFileSync("tar", [
      "-czf",
      archive,
      "-C",
      join(root, "archive-input"),
      "hermes-fixture",
    ]);
    const archiveSha256 = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    const contract = {
      release: "fixture",
      commit,
      archive_url: "https://invalid.example/hermes.tar.gz",
      archive_sha256: archiveSha256,
    };

    await ensureHermesSource(paths, contract);
    mkdirSync(join(paths.hermesSource, ".venv"));
    writeFileSync(join(paths.hermesSource, ".venv", "keep"), "derived\n");
    mkdirSync(join(paths.hermesSource, "hermes_agent.egg-info"));
    writeFileSync(
      join(paths.hermesSource, "hermes_agent.egg-info", "PKG-INFO"),
      "derived editable-install metadata\n",
    );
    await ensureHermesSource(paths, contract);
    expect(
      readFileSync(join(paths.hermesSource, ".venv", "keep"), "utf8"),
    ).toBe("derived\n");
    expect(
      readFileSync(
        join(paths.hermesSource, "hermes_agent.egg-info", "PKG-INFO"),
        "utf8",
      ),
    ).toBe("derived editable-install metadata\n");
    writeFileSync(
      join(paths.hermesSource, "package", "hermes_agent.egg-info", "PKG-INFO"),
      "tampered nested source\n",
    );

    await ensureHermesSource(paths, contract);

    expect(readFileSync(join(paths.hermesSource, "hermes.py"), "utf8")).toBe(
      "TRUSTED = True\n",
    );
    expect(
      readFileSync(
        join(
          paths.hermesSource,
          "package",
          "hermes_agent.egg-info",
          "PKG-INFO",
        ),
        "utf8",
      ),
    ).toBe("source-owned metadata\n");
    expect(existsSync(join(paths.hermesSource, ".venv"))).toBe(false);
    expect(
      readJson(join(paths.hermesSource, ".pythia-source.json")),
    ).toMatchObject({
      commit,
      archive_sha256: archiveSha256,
      source_tree_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("recovers only a receipt-owned interrupted first profile", async () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.profileRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.workspace, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.profileRoot, "partial"), "native scaffold\n");
    writeFileSync(join(paths.workspace, "owned"), "preserve me\n");
    atomicWriteJson(paths.profileInitialization, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "native-profile-created",
    });
    const result = await recoverDevelopmentInitialization(paths);
    expect(result.removed_profile).toBe(paths.profileRoot);
    expect(existsSync(paths.profileRoot)).toBe(false);
    expect(existsSync(paths.profileInitialization)).toBe(false);
    expect(readFileSync(join(paths.workspace, "owned"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(existsSync(paths.hermesRoot)).toBe(true);
    expect(existsSync(paths.preparationAdmission)).toBe(false);
  });

  it("never treats an intent-only marker as ownership of an existing profile", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.profileRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.profileRoot, "unknown-owner"), "preserve me\n");
    atomicWriteJson(paths.profileInitialization, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "started",
    });
    expect(() => recoverInterruptedProfileInitialization(paths)).toThrow(
      /ownership is ambiguous.*Refusing to delete/u,
    );
    expect(readFileSync(join(paths.profileRoot, "unknown-owner"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(existsSync(paths.profileInitialization)).toBe(true);
  });

  it("clears an intent-only marker when no profile exists", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    atomicWriteJson(paths.profileInitialization, {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "started",
    });
    expect(recoverInterruptedProfileInitialization(paths).recovered).toBe(true);
    expect(existsSync(paths.profileInitialization)).toBe(false);
  });

  it("refreshes the exact managed plugin files and rejects canonical source symlinks", () => {
    const root = temporaryRoot();
    const source = join(root, "source");
    const profile = join(root, "profile");
    const destination = join(profile, "plugins", "pythia");
    mkdirSync(source);
    writeFileSync(join(source, "__init__.py"), "FIRST = True\n");
    writeFileSync(join(source, "plugin.yaml"), "name: first\n");
    mkdirSync(join(source, "__pycache__"));
    writeFileSync(
      join(source, "__pycache__", "__init__.cpython-314.pyc"),
      "generated\n",
    );
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "stale.pyc"), "stale\n");
    writeFileSync(`${destination}.previous`, "foreign sibling\n");
    writeFileSync(join(profile, "user-state"), "preserve me\n");

    refreshManagedPlugin(source, destination);

    expect(lstatSync(destination).isSymbolicLink()).toBe(false);
    expect(readdirSync(destination).sort()).toEqual(
      [...MANAGED_PLUGIN_FILES].sort(),
    );
    expect(readFileSync(join(profile, "user-state"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(readFileSync(`${destination}.previous`, "utf8")).toBe(
      "foreign sibling\n",
    );
    writeFileSync(join(source, "plugin.yaml"), "name: second\n");
    refreshManagedPlugin(source, destination);
    expect(readFileSync(join(destination, "plugin.yaml"), "utf8")).toContain(
      "second",
    );
    rmSync(join(source, "__init__.py"));
    symlinkSync(join(source, "plugin.yaml"), join(source, "__init__.py"));
    expect(() => refreshManagedPlugin(source, destination)).toThrow(
      /input must be a regular file/u,
    );
    expect(readFileSync(join(destination, "plugin.yaml"), "utf8")).toContain(
      "second",
    );
  });

  it("refreshes only canonical managed Python inputs without replacing its environment", () => {
    const root = temporaryRoot();
    const source = join(root, "source");
    const runtimeRoot = join(root, "runtime");
    const destination = join(runtimeRoot, "managed-python");
    mkdirSync(source);
    for (const filename of MANAGED_PYTHON_SOURCE_FILES) {
      writeFileSync(join(source, filename), `${filename}\n`);
    }
    mkdirSync(join(source, ".venv", "bin"), { recursive: true });
    writeFileSync(join(source, ".venv", "bin", "python"), "generated\n");
    mkdirSync(join(destination, ".venv"), { recursive: true });
    writeFileSync(join(destination, ".venv", "stale"), "stale\n");
    writeFileSync(join(destination, "obsolete-input.txt"), "remove me\n");
    writeFileSync(join(runtimeRoot, "preserved"), "preserve me\n");

    refreshManagedPythonSource(source, destination);

    expect(readdirSync(destination).sort()).toEqual(
      [...MANAGED_PYTHON_SOURCE_FILES, ".venv"].sort(),
    );
    expect(readFileSync(join(destination, ".venv", "stale"), "utf8")).toBe(
      "stale\n",
    );
    expect(existsSync(join(destination, "obsolete-input.txt"))).toBe(false);
    expect(readFileSync(join(runtimeRoot, "preserved"), "utf8")).toBe(
      "preserve me\n",
    );
    rmSync(join(source, "uv.lock"));
    symlinkSync(join(source, "pyproject.toml"), join(source, "uv.lock"));
    expect(() => refreshManagedPythonSource(source, destination)).toThrow(
      /input must be a regular file/u,
    );
    expect(readdirSync(destination).sort()).toEqual(
      [...MANAGED_PYTHON_SOURCE_FILES, ".venv"].sort(),
    );
  });

  it("prepares locked dependencies before one runner build and reuses native environments", async () => {
    const root = temporaryRoot();
    const resolved = resolveStackPaths({ environment: environment(root) });
    const managedPythonSource = join(root, "managed-python-source");
    const managedPython = join(root, "managed-python-runtime");
    mkdirSync(managedPythonSource);
    for (const filename of MANAGED_PYTHON_SOURCE_FILES) {
      writeFileSync(join(managedPythonSource, filename), `${filename} first\n`);
    }
    mkdirSync(join(managedPython, ".venv", "bin"), { recursive: true });
    writeFileSync(
      join(managedPython, ".venv", "bin", "python"),
      "preserved interpreter\n",
    );
    const paths = { ...resolved, managedPythonSource, managedPython };
    const sourceContract = {
      install: { command: ["uv", "sync", "--frozen", "--extra", "all"] },
    };
    const actions: string[] = [];
    const options = {
      sourceContract,
      environment: { PATH: "/fixture/bin" },
      ensureHermesSource: async () => {
        actions.push("hermes-source");
      },
      runCommand: (command: string, args: string[]) => {
        actions.push(`${command} ${args.join(" ")}`);
        return "";
      },
    };

    await prepareManagedRuntime(paths, options);
    await prepareManagedRuntime(paths, options);
    writeFileSync(join(managedPythonSource, "uv.lock"), "uv.lock second\n");
    await prepareManagedRuntime(paths, options);

    const onePreparation = [
      "hermes-source",
      "uv sync --frozen --extra all",
      `uv sync --frozen --project ${managedPython}`,
      "pnpm install --frozen-lockfile",
      "pnpm run build:runtime",
    ];
    expect(actions).toEqual([
      ...onePreparation,
      ...onePreparation,
      ...onePreparation,
    ]);
    expect(
      readFileSync(join(managedPython, ".venv", "bin", "python"), "utf8"),
    ).toBe("preserved interpreter\n");
    expect(readFileSync(join(managedPython, "uv.lock"), "utf8")).toBe(
      "uv.lock second\n",
    );
  });
});
