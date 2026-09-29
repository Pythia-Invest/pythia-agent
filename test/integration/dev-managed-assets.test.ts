import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANAGED_CORE_FILES,
  refreshManagedPlugin,
  atomicWriteJson,
  readJson,
} from "../../scripts/dev/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import {
  ensureHermesSource,
  prepareManagedRuntime,
  recoverInterruptedProfileInitialization,
  refreshRuntimeAssets,
} from "../../scripts/dev/runtime.mjs";
import { recoverDevelopmentInitialization } from "../../scripts/dev/supervisor.mjs";
import { buildManagedWidgets } from "../../scripts/dev/build-managed-widgets.mjs";
import {
  developmentEnvironment,
  developmentPaths,
  repositoryRoot,
  temporaryRoot,
} from "../support/dev-stack";

describe("managed source and runtime preparation", () => {
  it("refreshes managed plugin files without changing later native user choices", async () => {
    // Widgets are built and managed plugins copied from the checkout.
    const root = temporaryRoot();
    const paths = developmentPaths(root, "snapshot");
    const managedCore = join(root, "managed-plugin");
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
    mkdirSync(managedCore, { recursive: true });
    for (const name of MANAGED_CORE_FILES) {
      mkdirSync(dirname(join(managedCore, name)), { recursive: true });
      writeFileSync(join(managedCore, name), "# synthetic plugin input\n");
    }
    writeFileSync(join(managedCore, "__init__.py"), "MANAGED = True\n");
    writeFileSync(join(managedCore, "plugin.yaml"), "name: pythia\n");
    writeFileSync(
      join(managedCore, "operating.py"),
      "# synthetic operating guidance\n",
    );
    writeFileSync(join(managedCore, "desk_view.py"), "# synthetic view tool\n");
    refreshManagedPlugin(
      managedCore,
      join(paths.profileRoot, "plugins", "pythia"),
    );
    writeFileSync(join(paths.profileRoot, "config.yaml"), userConfig);
    mkdirSync(join(paths.hermesSource, ".venv", "bin"), { recursive: true });
    writeFileSync(
      hermes,
      `#!/bin/sh
printf '%s\\n' "$*" >> '${commandLog}'
`,
      { mode: 0o755 },
    );
    chmodSync(hermes, 0o755);
    atomicWriteJson(paths.runtimeReceipt, {
      schema_version: 1,
      workspace_guidance: "[PYTHIA_WORKSPACE_GUIDANCE_V1]",
      stack: paths.id,
      profile: paths.profile,
      repository: paths.repositoryRoot,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
    });

    // A fresh source snapshot contains no generated widgets. Explicit
    // preparation must finish before copied-source validation or refresh.
    await buildManagedWidgets(paths.repositoryRoot);
    await refreshRuntimeAssets(
      { ...paths, managedCore },
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
      ["pythia"]
        .map(
          (name) =>
            `-p ${paths.profile} plugins doctor ${join(paths.profileRoot, "plugins", name)} --ci`,
        )
        .join("\n"),
    );
  });

  it("recreates a tampered Hermes source cache from the verified archive", async () => {
    const root = temporaryRoot();
    const paths = developmentPaths(root);
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
    const paths = developmentPaths();
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
    const paths = developmentPaths();
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
    const paths = developmentPaths();
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

  it.each(["development", "installed"])(
    "prepares %s with only Hermes Python and preserves any legacy environment",
    async (mode) => {
      const root = temporaryRoot();
      // Preparation reads only the pinned Hermes source contract.
      cpSync(
        join(repositoryRoot, "runtime/hermes"),
        join(
          developmentEnvironment(root).PYTHIA_DEV_REPO_ROOT,
          "runtime/hermes",
        ),
        { recursive: true },
      );
      const paths =
        mode === "development"
          ? developmentPaths(root)
          : resolveInstallPaths({
              HOME: root,
              PYTHIA_CHECKOUT:
                developmentEnvironment(root).PYTHIA_DEV_REPO_ROOT,
              PYTHIA_INSTALL_CONFIG_HOME: join(root, "config"),
              PYTHIA_INSTALL_STATE_HOME: join(root, "state"),
              PYTHIA_INSTALL_DATA_HOME: join(root, "data"),
              PYTHIA_INSTALL_CACHE_HOME: join(root, "cache"),
            });
      const nativePython = join(paths.hermesSource, ".venv", "bin", "python");
      mkdirSync(dirname(nativePython), { recursive: true });
      writeFileSync(nativePython, "prepared Hermes interpreter\n");
      const actions: { command: string; cwd: string }[] = [];
      const options = {
        environment: { PATH: "/fixture/bin" },
        ensureHermesSource: async () => {
          actions.push({ command: "hermes-source", cwd: paths.hermesSource });
        },
        runCommand: (
          command: string,
          args: string[],
          options: { cwd: string },
        ) => {
          actions.push({
            command: `${command} ${args.join(" ")}`,
            cwd: options.cwd,
          });
          return "";
        },
      };

      await prepareManagedRuntime(paths, options);
      expect(existsSync(paths.legacyPython)).toBe(false);
      const legacyFiles = {
        ".venv/bin/python": "preserved legacy interpreter\n",
        ".venv/bin/basic-memory": "preserved legacy Basic Memory\n",
        "pyproject.toml": "preserved legacy dependencies\n",
        "uv.lock": "preserved legacy lock\n",
      };
      for (const [filename, contents] of Object.entries(legacyFiles)) {
        const path = join(paths.legacyPython, filename);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
      }
      await prepareManagedRuntime(paths, options);

      const onePreparation = [
        { command: "hermes-source", cwd: paths.hermesSource },
        { command: "uv sync --frozen --extra all", cwd: paths.hermesSource },
        {
          command: "pnpm install --frozen-lockfile",
          cwd: paths.repositoryRoot,
        },
        { command: "pnpm run build:runtime", cwd: paths.repositoryRoot },
      ];
      expect(actions).toEqual([...onePreparation, ...onePreparation]);
      expect(readFileSync(nativePython, "utf8")).toBe(
        "prepared Hermes interpreter\n",
      );
      for (const [filename, contents] of Object.entries(legacyFiles)) {
        expect(readFileSync(join(paths.legacyPython, filename), "utf8")).toBe(
          contents,
        );
      }
    },
  );
});
