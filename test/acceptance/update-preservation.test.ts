import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { refreshManagedPlugin } from "../../scripts/dev/files.mjs";
import {
  atomicWriteJson,
  copyPrivateFile,
  readJson,
} from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import { installUnits, renderUnits } from "../../scripts/install/systemd.mjs";
import { applyUpdate, recoverUpdate } from "../../scripts/update/apply.mjs";
import { applyMigrations } from "../../scripts/update/migrations.mjs";
import {
  cleanupReleaseFixtures,
  createSnapshotFixture,
  git,
} from "../support/release-snapshot";

afterEach(cleanupReleaseFixtures);

function file(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
}

function hashTree(path: string): string {
  const hash = createHash("sha256");
  function visit(current: string, name = "") {
    const info = lstatSync(current);
    if (info.isSymbolicLink())
      throw new Error(`Unexpected symlink: ${current}`);
    if (info.isDirectory()) {
      hash.update(`d\0${name}\0${info.mode & 0o777}\0`);
      for (const entry of readdirSync(current).sort()) {
        visit(join(current, entry), name ? `${name}/${entry}` : entry);
      }
      return;
    }
    hash.update(`f\0${name}\0${info.mode & 0o777}\0`);
    hash.update(readFileSync(current));
  }
  visit(path);
  return hash.digest("hex");
}

function installedFixture() {
  const release = createSnapshotFixture({ signedOverlay: true });
  git(release.clone, ["checkout", "-B", "installed-a", "v0.0.1"]);
  const environment = {
    ...process.env,
    HOME: join(release.root, "home"),
    PYTHIA_CHECKOUT: release.clone,
    PYTHIA_INSTALL_BIN_HOME: join(release.root, "home", ".local", "bin"),
    PYTHIA_INSTALL_CACHE_HOME: join(release.root, "cache"),
    PYTHIA_INSTALL_CONFIG_HOME: join(release.root, "config"),
    PYTHIA_INSTALL_DATA_HOME: join(release.root, "data"),
    PYTHIA_INSTALL_STATE_HOME: join(release.root, "state"),
    PYTHIA_INSTALL_SYSTEMD_HOME: join(release.root, "units"),
  };
  const paths = resolveInstallPaths(environment);
  for (const path of [
    paths.configRoot,
    paths.stateRoot,
    paths.dataRoot,
    paths.cacheRoot,
    paths.profileRoot,
    paths.workspace,
    paths.knowledge,
    paths.basicMemoryConfig,
    paths.transactionRoot,
    paths.trustRoot,
  ]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  copyPrivateFile(release.allowedSigners, paths.allowedSigners);
  atomicWriteJson(paths.releaseFile, { schema_version: 1, channel: "stable" });
  atomicWriteJson(paths.installFile, {
    schema_version: 1,
    checkout: paths.checkout,
    channel: "stable",
    revision: release.revisionA,
  });

  const owned = {
    secrets: join(paths.configRoot, "secrets.json"),
    settings: join(paths.configRoot, "settings.json"),
    profile: join(paths.profileRoot, "config.yaml"),
    session: join(paths.profileRoot, "sessions", "session.json"),
    localSkill: join(
      paths.profileRoot,
      "skills",
      "eodhd-market-data",
      "SKILL.md",
    ),
    memoryConfig: join(paths.basicMemoryConfig, "config.json"),
    workspace: join(paths.workspace, "investor.txt"),
    knowledge: join(paths.knowledge, "case.md"),
  };
  atomicWriteJson(owned.secrets, {
    schema_version: 1,
    hermes_api_key: "SYNTHETIC_NOT_A_REAL_BEARER",
    eodhd_api_token: "SYNTHETIC_NOT_A_REAL_TOKEN",
  });
  atomicWriteJson(owned.settings, {
    schema_version: 1,
    sec_identity: "Example Investor example.invalid",
  });
  file(
    owned.profile,
    "skills:\n  disabled: [sec-edgar-research]\ntools:\n  api_server: [pythia-sec]\n  discord: [web]\n",
  );
  file(owned.session, '{"id":"synthetic-session","status":"complete"}\n');
  file(
    owned.localSkill,
    "---\nname: eodhd-market-data\ndescription: Device-owned override\n---\nLocal behavior.\n",
  );
  file(owned.memoryConfig, '{"auto_update":false,"semantic_search":false}\n');
  file(owned.workspace, "Device-owned workspace\n");
  file(owned.knowledge, "# Synthetic investment case\n\nKeep this Markdown.\n");

  const pluginDestination = join(paths.profileRoot, "plugins", "pythia");
  refreshManagedPlugin(
    join(paths.checkout, "runtime", "managed", "plugin"),
    pluginDestination,
  );
  file(join(pluginDestination, "stale-generated.pyc"), "stale\n");
  const executables = {
    node: "/opt/pythia/node",
    python: "/opt/pythia/python",
    managedPython: "/opt/pythia/managed-python",
    uv: "/opt/pythia/uv",
    hermes: "/opt/pythia/hermes",
    basicMemory: "/opt/pythia/basic-memory",
    next: "/opt/pythia/next",
  };
  installUnits(paths, renderUnits(paths, executables));
  const unitBefore = hashTree(paths.unitRoot);
  const preservedBefore = Object.fromEntries(
    Object.entries(owned).map(([name, path]) => [name, hashTree(path)]),
  );

  async function completeCandidate() {
    refreshManagedPlugin(
      join(paths.checkout, "runtime", "managed", "plugin"),
      pluginDestination,
    );
    applyMigrations(paths);
    installUnits(paths, renderUnits(paths, executables));
  }

  async function interruptCandidate(
    stage: "dependency" | "plugin" | "migration" | "unit",
  ) {
    if (stage === "dependency") {
      throw new Error("synthetic dependency interruption");
    }
    refreshManagedPlugin(
      join(paths.checkout, "runtime", "managed", "plugin"),
      pluginDestination,
    );
    if (stage === "plugin") {
      throw new Error("synthetic plugin interruption");
    }
    applyMigrations(paths);
    if (stage === "migration") {
      throw new Error("synthetic migration interruption");
    }
    installUnits(paths, renderUnits(paths, executables));
    throw new Error("synthetic unit interruption");
  }

  return {
    completeCandidate,
    executables,
    owned,
    paths,
    pluginDestination,
    interruptCandidate,
    preservedBefore,
    release,
    unitBefore,
  };
}

describe("signed A-to-B state preservation", () => {
  it("advances source and units while retaining every device-owned layer", async () => {
    const fixture = installedFixture();
    const actions: string[] = [];
    await applyUpdate(fixture.paths, {
      stop: async () => actions.push("stop"),
      completeCandidate: async () => {
        actions.push("prepare");
        await fixture.completeCandidate();
      },
      startAndVerify: async () => actions.push("start"),
    });

    expect(git(fixture.paths.checkout, ["rev-parse", "HEAD"])).toBe(
      fixture.release.revisionB,
    );
    expect(actions).toEqual(["stop", "prepare", "start"]);
    expect(hashTree(fixture.paths.unitRoot)).not.toBe(fixture.unitBefore);
    expect(
      readFileSync(
        join(fixture.paths.unitRoot, "pythia-agent-desk.service"),
        "utf8",
      ),
    ).toContain(
      "Wants=pythia-agent-hermes.service pythia-agent-basic-memory.service",
    );
    for (const [name, path] of Object.entries(fixture.owned)) {
      expect(hashTree(path), name).toBe(fixture.preservedBefore[name]);
    }
    expect(
      existsSync(join(fixture.pluginDestination, "stale-generated.pyc")),
    ).toBe(false);
    expect(readdirSync(fixture.pluginDestination).sort()).toEqual([
      "__init__.py",
      "plugin.yaml",
    ]);
    expect(
      existsSync(
        join(
          fixture.paths.checkout,
          "runtime/managed/skills/eodhd-market-data/SKILL.md",
        ),
      ),
    ).toBe(true);
    expect(readJson(fixture.paths.installFile).revision).toBe(
      fixture.release.revisionB,
    );
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({ phase: "complete", services: "running" });
  });

  it.each(["dependency", "plugin", "migration", "unit"])(
    "leaves services stopped and recovers a %s-stage interruption",
    async (stage) => {
      const fixture = installedFixture();
      await expect(
        applyUpdate(fixture.paths, {
          stop: async () => undefined,
          completeCandidate: async () =>
            fixture.interruptCandidate(
              stage as "dependency" | "plugin" | "migration" | "unit",
            ),
          startAndVerify: async () => undefined,
        }),
      ).rejects.toThrow(`synthetic ${stage} interruption`);
      expect(
        readJson(join(fixture.paths.transactionRoot, "active.json")),
      ).toMatchObject({ phase: "failed-stopped", services: "stopped" });
      expect(git(fixture.paths.checkout, ["rev-parse", "HEAD"])).toBe(
        fixture.release.revisionB,
      );
      expect(
        existsSync(join(fixture.pluginDestination, "stale-generated.pyc")),
      ).toBe(stage === "dependency");
      expect(existsSync(join(fixture.paths.stateRoot, "migrations.json"))).toBe(
        stage === "migration" || stage === "unit",
      );
      if (stage === "unit") {
        expect(hashTree(fixture.paths.unitRoot)).not.toBe(fixture.unitBefore);
      }

      const recovered = await recoverUpdate(fixture.paths, {
        stop: async () => undefined,
        completeCandidate: fixture.completeCandidate,
        startAndVerify: async () => undefined,
      });
      expect(recovered.receipt).toMatchObject({
        phase: "complete",
        services: "running",
      });
      expect(applyMigrations(fixture.paths)).toEqual(["0001-device-state-v1"]);
    },
  );

  it("keeps a start failure stopped until health-confirmed recovery", async () => {
    const fixture = installedFixture();
    let stopCount = 0;
    await expect(
      applyUpdate(fixture.paths, {
        stop: async () => {
          stopCount += 1;
        },
        completeCandidate: fixture.completeCandidate,
        startAndVerify: async () => {
          throw new Error("synthetic start failure");
        },
      }),
    ).rejects.toThrow("synthetic start failure");
    expect(stopCount).toBe(2);
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({ phase: "failed-stopped", services: "stopped" });
    expect(readJson(fixture.paths.installFile).revision).toBe(
      fixture.release.revisionA,
    );
    await recoverUpdate(fixture.paths, {
      stop: async () => undefined,
      completeCandidate: fixture.completeCandidate,
      startAndVerify: async () => undefined,
    });
    expect(
      readJson(join(fixture.paths.transactionRoot, "active.json")),
    ).toMatchObject({ phase: "complete", services: "running" });
    expect(readJson(fixture.paths.installFile).revision).toBe(
      fixture.release.revisionB,
    );
  });
});
