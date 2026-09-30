import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  redactedEnvironment,
  runtimeEnvironment,
} from "../../scripts/dev/environment.mjs";
import {
  ensurePrivateDirectory,
  ensurePrivateTree,
  readJson,
} from "../../scripts/dev/files.mjs";
import { secrets } from "../../scripts/dev/runtime-config.mjs";
import {
  developmentPrivateRoots,
  installSeeds,
} from "../../scripts/dev/runtime.mjs";
import { developmentServices } from "../../scripts/dev/supervisor.mjs";
import { verifyBasicMemoryNativeProject } from "../../scripts/install/basic-memory-readiness.mjs";
import { developmentPaths, temporaryRoot } from "../support/dev-stack";

describe("private roots, environment, seeds, and copied assets", () => {
  it("rejects a stale native Basic Memory mapping despite a matching Pythia receipt", () => {
    const root = temporaryRoot();
    const paths = developmentPaths(root);
    expect(() =>
      verifyBasicMemoryNativeProject(
        paths,
        "/managed/basic-memory",
        {},
        {
          run: () =>
            JSON.stringify({
              project_name: paths.id,
              project_path: join(root, "foreign-knowledge"),
              available_projects: {
                [paths.id]: {
                  path: join(root, "foreign-knowledge"),
                  is_default: true,
                },
              },
              default_project: paths.id,
              system: { version: "0.23.2" },
              embedding_status: { semantic_search_enabled: false },
            }),
        },
      ),
    ).toThrow(/native project mapping/u);
  });

  it("rejects loose credential-root permissions", () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    const path = join(root, "credentials");
    mkdirSync(path, { mode: 0o755 });
    chmodSync(path, 0o755);
    expect(() => ensurePrivateDirectory(path)).toThrow(
      /permissions are too open/u,
    );
  });

  it("creates per-stack data and cache as private bootstrap roots", () => {
    const paths = developmentPaths();
    ensurePrivateTree(developmentPrivateRoots(paths));
    for (const path of [paths.dataRoot, paths.cacheRoot]) {
      expect(lstatSync(path).isDirectory()).toBe(true);
      if (process.platform !== "win32") {
        expect(lstatSync(path).mode & 0o077).toBe(0);
      }
    }
  });

  it("removes ambient credentials and gives each service only its own bearer", () => {
    const paths = developmentPaths();
    const clean = runtimeEnvironment(paths, "safe-local-key-value", {
      PATH: process.env.PATH,
      OPENAI_API_KEY: "must-not-survive",
      AWS_SECRET_ACCESS_KEY: "must-not-survive",
      AWS_ACCESS_KEY_ID: "must-not-survive",
      EODHD_API_TOKEN: "must-not-survive",
      EDGAR_IDENTITY: "must-not-survive",
      EDGAR_API_TOKEN: "must-not-survive",
      // The shipped 562dfc9 plugin still reads this retired interpreter.
      PYTHIA_PYTHON: "/retired/python",
      NEXT_TELEMETRY_DISABLED: "0",
      HERMES_DISABLE_LAZY_INSTALLS: "0",
      ORDINARY_SETTING: "visible",
    });
    expect(clean.OPENAI_API_KEY).toBeUndefined();
    expect(clean.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(clean.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(clean.EODHD_API_TOKEN).toBeUndefined();
    expect(clean.EDGAR_IDENTITY).toBeUndefined();
    expect(clean.EDGAR_API_TOKEN).toBeUndefined();
    expect(clean.PYTHIA_PYTHON).toBeUndefined();
    expect(clean.ORDINARY_SETTING).toBe("visible");
    expect(clean.NEXT_TELEMETRY_DISABLED).toBe("1");
    expect(clean.HERMES_DISABLE_LAZY_INSTALLS).toBe("1");
    expect(clean.API_SERVER_HOST).toBe("127.0.0.1");
    expect(clean.HERMES_HOME).toBe(paths.hermesRoot);
    expect(clean.PYTHIA_CONFIG_ROOT).toBe(paths.configRoot);
    expect(clean.PYTHIA_STATE_ROOT).toBe(paths.stateRoot);
    // Pythia's store and document cache are per stack, never shared config.
    expect(clean.PYTHIA_DATA_ROOT).toBe(paths.dataRoot);
    expect(clean.PYTHIA_CACHE_ROOT).toBe(paths.cacheRoot);
    expect(clean.PYTHIA_DESK_VIEW_STATE).toBe(paths.deskViewState);
    expect(clean.PYTHIA_MANAGED_ROOT).toBe(paths.managedRoot);
    expect(clean.PYTHIA_NODE).toBe(process.execPath);
    expect(clean.PYTHIA_HERMES_PROFILE).toBe(paths.profile);
    expect(clean.PYTHIA_HERMES_EXECUTABLE).toBe(
      join(paths.hermesSource, ".venv", "bin", "hermes"),
    );
    expect(clean.PYTHIA_DEV_LIFECYCLE_CLI).toBe(
      join(paths.repositoryRoot, "scripts", "dev", "cli.mjs"),
    );
    const services = developmentServices(paths, clean, "settings-bearer-value");
    expect(services[0]?.cwd).toBe(paths.workspace);
    expect(services.map((service) => service.name)).toEqual([
      "hermes",
      "hermes-settings",
      "desk",
    ]);
    const [hermes, settings, desk] = services;
    expect(hermes?.environment.API_SERVER_KEY).toBe("safe-local-key-value");
    expect(hermes?.environment.HERMES_DASHBOARD_SESSION_TOKEN).toBeUndefined();
    // The settings server gets only its own bearer, on loopback, for
    // Pythia's profile alone.
    expect(settings?.environment.API_SERVER_KEY).toBeUndefined();
    expect(settings?.environment.HERMES_DASHBOARD_SESSION_TOKEN).toBe(
      "settings-bearer-value",
    );
    expect(settings?.args).toEqual([
      "-p",
      paths.profile,
      "serve",
      "--isolated",
      "--host",
      "127.0.0.1",
      "--port",
      String(paths.ports.settings),
    ]);
    expect(desk?.environment.API_SERVER_KEY).toBe("safe-local-key-value");
    expect(desk?.environment.PYTHIA_HERMES_SETTINGS_TOKEN).toBe(
      "settings-bearer-value",
    );
    expect(desk?.environment.PYTHIA_HERMES_SETTINGS_URL).toBe(
      `http://127.0.0.1:${paths.ports.settings}`,
    );
    expect(
      JSON.stringify(
        redactedEnvironment({ API_SERVER_KEY: "x", SECRET: "x", OK: "y" }),
      ),
    ).not.toContain("x");
  });

  it("adds a settings bearer to an existing store without rotating the API key", () => {
    const paths = developmentPaths();
    mkdirSync(paths.configRoot, { recursive: true, mode: 0o700 });
    const store = join(paths.configRoot, "secrets.json");
    const apiKey = "A".repeat(43);
    writeFileSync(
      store,
      JSON.stringify({ schema_version: 1, hermes_api_key: apiKey }),
      { mode: 0o600 },
    );
    const upgraded = secrets(paths);
    expect(upgraded.hermes_api_key).toBe(apiKey);
    expect(upgraded.hermes_settings_token).toMatch(/^[\w-]{43}$/u);
    expect(upgraded.hermes_settings_token).not.toBe(apiKey);
    // Stable once issued, and stored privately.
    expect(secrets(paths)).toEqual(upgraded);
    expect(readJson(store)).toEqual(upgraded);
    expect(lstatSync(store).mode & 0o077).toBe(0);
  });

  it("keeps the legacy service only during an explicit staged transition", () => {
    const paths = developmentPaths();
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(paths.stateRoot, "workspace-transition.json"),
      JSON.stringify({
        version: 1,
        stack: paths.id,
        profileRoot: paths.profileRoot,
        workspace: paths.workspace,
        knowledge: paths.knowledge,
        backupRoot: join(paths.stateRoot, "workspace-transition-backup"),
        importRoot: join(paths.workspace, "imported-research-1"),
        files: [],
        seeds: [],
        phase: "staged",
      }),
    );
    const services = developmentServices(
      paths,
      runtimeEnvironment(paths, "fixture-key", {}),
      "fixture-settings-bearer",
    );
    expect(services.map((service) => service.name)).toEqual([
      "hermes",
      "hermes-settings",
      "desk",
      "basic-memory",
    ]);
    const legacy = services[3];
    expect(legacy?.environment.API_SERVER_KEY).toBeUndefined();
    expect(legacy?.environment.PYTHIA_DESK_VIEW_STATE).toBeUndefined();
    expect(legacy?.environment.BASIC_MEMORY_CONFIG_DIR).toBe(
      paths.basicMemoryConfig,
    );
    expect(legacy?.command).toBe(
      join(paths.legacyPython, ".venv", "bin", "basic-memory"),
    );
  });

  it("installs the fresh Pythia scaffold once and preserves later edits", () => {
    // Seeds are read from the checkout.
    const paths = developmentPaths(temporaryRoot(), "snapshot");
    mkdirSync(paths.profileRoot, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.hermesRoot, "auth.json"), "fixture credential\n", {
      mode: 0o600,
    });
    writeFileSync(
      join(paths.profileRoot, "config.yaml"),
      "upstream: default\n",
    );
    writeFileSync(join(paths.profileRoot, "SOUL.md"), "upstream default\n");
    const first = installSeeds(paths, { freshProfile: true });
    expect(first.installed).toContain("hermes-profile/config.yaml");
    expect(
      readFileSync(join(paths.profileRoot, "config.yaml"), "utf8"),
    ).toContain("auxiliary:\n  free_only: true\n");
    // Desk's own tools reach the API server platform.
    expect(
      readFileSync(join(paths.profileRoot, "config.yaml"), "utf8"),
    ).toMatch(/^ {2}api_server:\n(?: {4}- \S+\n)*? {4}- pythia-desk\n/mu);
    expect(readFileSync(join(paths.profileRoot, "SOUL.md"), "utf8")).toContain(
      "Pythia",
    );
    for (const path of [
      join(paths.workspace, "AGENTS.md"),
      join(paths.workspace, "DATA_SOURCES.md"),
      join(paths.workspace, "README.md"),
      join(paths.workspace, "strategies", "README.md"),
    ]) {
      expect(lstatSync(path).isFile()).toBe(true);
    }
    const userConfig = `auxiliary:
  free_only: false
terminal:
  cwd: /user/chosen/workspace
plugins:
  disabled:
    - pythia
platform_toolsets:
  api_server:
    - file
`;
    writeFileSync(join(paths.profileRoot, "config.yaml"), userConfig);
    writeFileSync(join(paths.profileRoot, "SOUL.md"), "my later edit\n");
    const userFiles = [
      join(paths.workspace, "AGENTS.md"),
      join(paths.workspace, "DATA_SOURCES.md"),
      join(paths.workspace, "README.md"),
      join(paths.workspace, "strategies", "README.md"),
    ];
    for (const path of userFiles) writeFileSync(path, `user edit ${path}\n`);
    rmSync(join(paths.workspace, "strategies", "README.md"));
    const second = installSeeds(paths);
    expect(second).toEqual({
      installed: [],
      preserved: [],
      skipped: "profile-already-initialized",
    });
    expect(readFileSync(join(paths.profileRoot, "config.yaml"), "utf8")).toBe(
      userConfig,
    );
    expect(readFileSync(join(paths.profileRoot, "SOUL.md"), "utf8")).toBe(
      "my later edit\n",
    );
    expect(readFileSync(join(paths.hermesRoot, "auth.json"), "utf8")).toBe(
      "fixture credential\n",
    );
    for (const path of userFiles.filter(
      (path) => path !== join(paths.workspace, "strategies", "README.md"),
    )) {
      expect(readFileSync(path, "utf8")).toBe(`user edit ${path}\n`);
    }
    expect(existsSync(join(paths.workspace, "strategies", "README.md"))).toBe(
      false,
    );
    const receipt = readJson(join(paths.stateRoot, "seed-receipt.json"));
    expect(receipt.fresh_profile_transaction).toBe(true);
  });
});
