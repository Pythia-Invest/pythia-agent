import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  redactedEnvironment,
  runtimeEnvironment,
} from "../../scripts/dev/environment.mjs";
import {
  ensurePrivateDirectory,
  ensurePrivateTree,
  readJson,
} from "../../scripts/dev/files.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import {
  developmentPrivateRoots,
  installSeeds,
} from "../../scripts/dev/runtime.mjs";
import { developmentServices } from "../../scripts/dev/supervisor.mjs";
import { verifyBasicMemoryNativeProject } from "../../scripts/install/basic-memory-readiness.mjs";
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

describe("private roots, environment, seeds, and copied assets", () => {
  it("rejects a stale native Basic Memory mapping despite a matching Pythia receipt", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
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

  it("creates per-stack EDGAR data and cache as private bootstrap roots", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    ensurePrivateTree(developmentPrivateRoots(paths));
    for (const path of [paths.edgarData, paths.edgarCache]) {
      expect(lstatSync(path).isDirectory()).toBe(true);
      if (process.platform !== "win32") {
        expect(lstatSync(path).mode & 0o077).toBe(0);
      }
    }
  });

  it("removes ambient credentials and fixes Basic Memory offline settings", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
    const clean = runtimeEnvironment(paths, "safe-local-key-value", {
      PATH: process.env.PATH,
      OPENAI_API_KEY: "must-not-survive",
      AWS_SECRET_ACCESS_KEY: "must-not-survive",
      AWS_ACCESS_KEY_ID: "must-not-survive",
      EODHD_API_TOKEN: "must-not-survive",
      EDGAR_IDENTITY: "must-not-survive",
      EDGAR_API_TOKEN: "must-not-survive",
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
    expect(clean.ORDINARY_SETTING).toBe("visible");
    expect(clean.BASIC_MEMORY_NO_PROMOS).toBe("true");
    expect(clean.BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED).toBe("false");
    expect(clean.FASTMCP_CHECK_FOR_UPDATES).toBe("off");
    expect(clean.FASTMCP_SHOW_SERVER_BANNER).toBe("false");
    expect(clean.NEXT_TELEMETRY_DISABLED).toBe("1");
    expect(clean.HERMES_DISABLE_LAZY_INSTALLS).toBe("1");
    expect(clean.BASIC_MEMORY_CONFIG_DIR).toBe(paths.basicMemoryConfig);
    expect(clean.API_SERVER_HOST).toBe("127.0.0.1");
    expect(clean.PYTHIA_HERMES_API_KEY).toBeUndefined();
    expect(clean.HERMES_HOME).toBe(paths.hermesRoot);
    expect(clean.PYTHIA_CONFIG_ROOT).toBe(paths.configRoot);
    expect(clean.PYTHIA_STATE_ROOT).toBe(paths.stateRoot);
    expect(clean.PYTHIA_MANAGED_ROOT).toBe(paths.managedRoot);
    expect(clean.PYTHIA_EDGAR_DATA_DIR).toBe(paths.edgarData);
    expect(clean.PYTHIA_EDGAR_CACHE_DIR).toBe(paths.edgarCache);
    expect(clean.PYTHIA_PYTHON).toBe(
      join(paths.managedPython, ".venv", "bin", "python"),
    );
    expect(clean.PYTHIA_NODE).toBe(process.execPath);
    expect(clean.PYTHIA_CONFIG_DIR).toBeUndefined();
    expect(clean.PYTHIA_HERMES_PROFILE).toBe(paths.profile);
    expect(clean.PYTHIA_HERMES_EXECUTABLE).toBe(
      join(paths.hermesSource, ".venv", "bin", "hermes"),
    );
    expect(clean.PYTHIA_DEV_LIFECYCLE_CLI).toBe(
      join(paths.repositoryRoot, "scripts", "dev", "cli.mjs"),
    );
    const services = developmentServices(paths, clean);
    expect(services[0]?.cwd).toBe(paths.workspace);
    expect(services[1]?.environment.API_SERVER_KEY).toBeUndefined();
    expect(services[0]?.environment.API_SERVER_KEY).toBe(
      "safe-local-key-value",
    );
    expect(services[2]?.environment.API_SERVER_KEY).toBe(
      "safe-local-key-value",
    );
    expect(
      JSON.stringify(
        redactedEnvironment({ API_SERVER_KEY: "x", SECRET: "x", OK: "y" }),
      ),
    ).not.toContain("x");
  });

  it("installs the fresh Pythia scaffold once and preserves later edits", () => {
    const root = temporaryRoot();
    const paths = resolveStackPaths({ environment: environment(root) });
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
    const expectedPlatformToolsets = `platform_toolsets:
  cli:
    - cronjob
    - delegation
    - file
    - memory
    - session_search
    - skills
    - terminal
    - todo
    - vision
    - web
  cron:
    - cronjob
    - delegation
    - file
    - memory
    - session_search
    - skills
    - terminal
    - todo
    - vision
    - web
  api_server:
    - cronjob
    - delegation
    - file
    - memory
    - session_search
    - skills
    - terminal
    - todo
    - vision
    - web
`;
    expect(
      readFileSync(join(paths.profileRoot, "config.yaml"), "utf8"),
    ).toContain(expectedPlatformToolsets);
    expect(readFileSync(join(paths.profileRoot, "SOUL.md"), "utf8")).toContain(
      "Pythia",
    );
    for (const path of [
      join(paths.workspace, "AGENTS.md"),
      join(paths.workspace, "DATA_SOURCES.md"),
      join(paths.workspace, "portfolio", "README.md"),
      join(paths.workspace, "cases", "README.md"),
      join(paths.workspace, "scratch", "README.md"),
      join(paths.knowledge, "README.md"),
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
      join(paths.workspace, "portfolio", "README.md"),
      join(paths.workspace, "cases", "README.md"),
      join(paths.workspace, "scratch", "README.md"),
      join(paths.knowledge, "README.md"),
    ];
    for (const path of userFiles) writeFileSync(path, `user edit ${path}\n`);
    rmSync(join(paths.workspace, "scratch", "README.md"));
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
      (path) => path !== join(paths.workspace, "scratch", "README.md"),
    )) {
      expect(readFileSync(path, "utf8")).toBe(`user edit ${path}\n`);
    }
    expect(existsSync(join(paths.workspace, "scratch", "README.md"))).toBe(
      false,
    );
    const receipt = readJson(join(paths.stateRoot, "seed-receipt.json"));
    expect(receipt.fresh_profile_transaction).toBe(true);
  });
});
