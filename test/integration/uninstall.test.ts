import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import { UNIT_NAMES } from "../../scripts/install/systemd.mjs";
import { prepareManagedRuntime } from "../../scripts/dev/runtime-prepare.mjs";
import { assertWorkspaceTransitionReady } from "../../scripts/update/workspace-transition-state.mjs";
import { uninstall } from "../../scripts/uninstall/uninstall.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];
const LEGACY_UNIT = "pythia-agent-basic-memory.service";

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-uninstall-test-"));
  roots.push(root);
  const paths = resolveInstallPaths({
    ...process.env,
    HOME: join(root, "home"),
    PYTHIA_CHECKOUT: repositoryRoot,
    PYTHIA_INSTALL_BIN_HOME: join(root, "bin"),
    PYTHIA_INSTALL_CACHE_HOME: join(root, "cache"),
    PYTHIA_INSTALL_CONFIG_HOME: join(root, "config"),
    PYTHIA_INSTALL_DATA_HOME: join(root, "data"),
    PYTHIA_INSTALL_STATE_HOME: join(root, "state"),
    PYTHIA_INSTALL_SYSTEMD_HOME: join(root, "units"),
  });
  for (const path of [
    paths.configRoot,
    paths.stateRoot,
    paths.runtimeRoot,
    paths.cacheRoot,
    paths.binRoot,
    paths.unitRoot,
  ]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  writeFileSync(paths.installedCommand, "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(join(paths.runtimeRoot, "owned"), "runtime\n");
  writeFileSync(join(paths.configRoot, "settings.json"), "{}\n", {
    mode: 0o600,
  });
  writeFileSync(join(paths.cacheRoot, "owned"), "cache\n");
  for (const name of UNIT_NAMES) {
    writeFileSync(join(paths.unitRoot, name), "[Unit]\n", { mode: 0o600 });
  }
  atomicWriteJson(paths.installFile, {
    schema_version: 1,
    checkout: paths.checkout,
    revision: "a".repeat(40),
  });
  atomicWriteJson(paths.runtimeReceipt, { schema_version: 1 });
  return { paths };
}

function expectOwnershipPreserved(paths: ReturnType<typeof fixture>["paths"]) {
  expect(existsSync(paths.installedCommand)).toBe(true);
  expect(existsSync(paths.runtimeRoot)).toBe(true);
  expect(existsSync(paths.installFile)).toBe(true);
  expect(existsSync(paths.runtimeReceipt)).toBe(true);
  expect(existsSync(paths.configRoot)).toBe(true);
  expect(existsSync(paths.stateRoot)).toBe(true);
  expect(existsSync(paths.cacheRoot)).toBe(true);
  for (const name of UNIT_NAMES) {
    expect(existsSync(join(paths.unitRoot, name))).toBe(true);
  }
}

describe("fail-closed uninstall", () => {
  it.each([false, true])(
    "preserves every ownership artifact when stop is unconfirmed (purge=%s)",
    (purge) => {
      const { paths } = fixture();
      const disable = vi.fn();
      const removeUnits = vi.fn();
      const reload = vi.fn();
      let thrown: unknown;
      try {
        uninstall(paths, {
          purge,
          actions: {
            stop: () => {
              throw new Error("synthetic user-bus failure");
            },
            unitState: (name: string) =>
              name === LEGACY_UNIT
                ? "absent"
                : name === "pythia-agent-hermes.service"
                  ? "active"
                  : "inactive",
            disable,
            enablement: () => "enabled",
            removeUnits,
            reload,
          },
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: "uninstall_stop_unconfirmed" });
      expect(disable).not.toHaveBeenCalled();
      expect(removeUnits).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expectOwnershipPreserved(paths);
      expect(
        JSON.parse(
          readFileSync(join(paths.transactionRoot, "active.json"), "utf8"),
        ),
      ).toMatchObject({
        operation: "uninstall",
        phase: "failed-stopped",
        services: "stop-unconfirmed",
        purge_requested: purge,
        error_code: "uninstall_stop_unconfirmed",
        unit_states: { "pythia-agent-hermes.service": "active" },
      });
    },
  );

  it("preserves ownership when disablement cannot be confirmed", () => {
    const { paths } = fixture();
    const removeUnits = vi.fn();
    const reload = vi.fn();
    expect(() =>
      uninstall(paths, {
        purge: true,
        actions: {
          stop: () => undefined,
          unitState: (name: string) =>
            name === LEGACY_UNIT ? "absent" : "inactive",
          disable: () => {
            throw new Error("synthetic disable failure");
          },
          enablement: () => "enabled",
          removeUnits,
          reload,
        },
      }),
    ).toThrow("nothing was removed");
    expect(removeUnits).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expectOwnershipPreserved(paths);
    expect(
      JSON.parse(
        readFileSync(join(paths.transactionRoot, "active.json"), "utf8"),
      ),
    ).toMatchObject({
      services: "stopped",
      error_code: "uninstall_disable_unconfirmed",
      target_enablement: "enabled",
    });
  });

  it.each(["pending", "staged"])(
    "refuses %s Workspace removal before even attempting a legacy stop",
    (phase) => {
      const { paths } = fixture();
      mkdirSync(paths.profileRoot, { recursive: true });
      writeFileSync(
        join(paths.profileRoot, "config.yaml"),
        "legacy investor configuration",
      );
      writeFileSync(
        join(paths.unitRoot, LEGACY_UNIT),
        "custom or owned retained legacy unit",
      );
      if (phase === "staged")
        atomicWriteJson(join(paths.stateRoot, "workspace-transition.json"), {
          version: 1,
          stack: paths.id,
          profileRoot: paths.profileRoot,
          workspace: paths.workspace,
          knowledge: paths.knowledge,
          backupRoot: join(paths.stateRoot, "workspace-transition-backup"),
          importRoot: join(paths.workspace, "imported-research-1"),
          files: [],
          seeds: [],
          phase,
        });
      const stop = vi.fn(() => {
        throw new Error("legacy stop would fail");
      });
      const removeUnits = vi.fn();
      expect(() =>
        uninstall(paths, {
          purge: true,
          actions: { stop, removeUnits, unitState: () => "active" },
        }),
      ).toThrow(`transition ${phase}`);
      expect(stop).not.toHaveBeenCalled();
      expect(removeUnits).not.toHaveBeenCalled();
      expectOwnershipPreserved(paths);
      expect(readFileSync(join(paths.unitRoot, LEGACY_UNIT), "utf8")).toBe(
        "custom or owned retained legacy unit",
      );
    },
  );

  it.each(["active", "inactive", "unconfirmed"])(
    "preserves a %s legacy unit when the profile is missing",
    (legacyState) => {
      const { paths } = fixture();
      const stop = vi.fn(() => {
        throw new Error("failed stop");
      });
      const removeUnits = vi.fn();
      expect(() =>
        uninstall(paths, {
          actions: {
            stop,
            removeUnits,
            unitState: (name: string) =>
              name === LEGACY_UNIT ? legacyState : "inactive",
          },
        }),
      ).toThrow("nothing was stopped or removed");
      expect(stop).not.toHaveBeenCalled();
      expect(removeUnits).not.toHaveBeenCalled();
      expectOwnershipPreserved(paths);
    },
  );

  it("preserves an unloaded custom legacy unit file even with absent process readback", () => {
    const { paths } = fixture();
    const file = join(paths.unitRoot, LEGACY_UNIT);
    writeFileSync(file, "[Service]\nExecStart=/custom/investor-service\n");
    const stop = vi.fn();
    expect(() =>
      uninstall(paths, { actions: { stop, unitState: () => "absent" } }),
    ).toThrow("Legacy Basic Memory");
    expect(stop).not.toHaveBeenCalled();
    expectOwnershipPreserved(paths);
    expect(readFileSync(file, "utf8")).toContain("/custom/investor-service");
  });

  it("retains fresh Workspace adoption through default uninstall and reaches reinstall preparation", async () => {
    const { paths } = fixture();
    mkdirSync(paths.profileRoot, { recursive: true });
    const config = "terminal:\n  cwd: /investor/custom-work\n";
    writeFileSync(join(paths.profileRoot, "config.yaml"), config);
    writeFileSync(
      join(paths.profileRoot, "SOUL.md"),
      "Investor-owned instructions",
    );
    // Successful fresh bootstrap's durable initialization receipt, distinct
    // from its disposable runtime activation receipt.
    const adoption = {
      schema_version: 1,
      stack: paths.id,
      repository: paths.repositoryRoot,
      profile: paths.profile,
      hermes_root: paths.hermesRoot,
      state_root: paths.stateRoot,
      profile_initially_absent: true,
      status: "complete",
      workspace_guidance: "[PYTHIA_WORKSPACE_GUIDANCE_V1]",
    };
    atomicWriteJson(paths.profileInitialization, adoption);
    expect(() => assertWorkspaceTransitionReady(paths)).not.toThrow();
    uninstall(paths, {
      actions: {
        stop: () => undefined,
        unitState: () => "absent",
        disable: () => undefined,
        enablement: () => "disabled",
        removeUnits: () => undefined,
        reload: () => undefined,
      },
    });
    expect(existsSync(paths.runtimeReceipt)).toBe(false);
    expect(existsSync(paths.runtimeRoot)).toBe(false);
    expect(
      JSON.parse(readFileSync(paths.profileInitialization, "utf8")),
    ).toEqual(adoption);
    expect(readFileSync(join(paths.profileRoot, "config.yaml"), "utf8")).toBe(
      config,
    );
    expect(readFileSync(join(paths.profileRoot, "SOUL.md"), "utf8")).toBe(
      "Investor-owned instructions",
    );
    const preparation = vi.fn(() => {
      throw new Error("reinstall reached managed preparation");
    });
    await expect(
      prepareManagedRuntime(paths, { ensureHermesSource: preparation }),
    ).rejects.toThrow("reinstall reached managed preparation");
    expect(preparation).toHaveBeenCalledOnce();
    for (const invalid of [
      { ...adoption, status: "started" },
      { ...adoption, stack: "foreign" },
      { ...adoption, profile_initially_absent: false },
    ]) {
      atomicWriteJson(paths.profileInitialization, invalid);
      expect(() => assertWorkspaceTransitionReady(paths)).toThrow(
        "transition pending",
      );
    }
  });

  it("accepts command failures only after explicit absent-state readback", () => {
    const { paths } = fixture();
    const inspected: string[] = [];
    const result = uninstall(paths, {
      actions: {
        stop: () => {
          throw new Error("already absent");
        },
        unitState: (name: string) => {
          inspected.push(name);
          return "absent";
        },
        disable: () => {
          throw new Error("already absent");
        },
        enablement: () => "not-found",
        removeUnits: () => undefined,
        reload: () => undefined,
      },
    });
    expect(inspected).toEqual([LEGACY_UNIT, ...UNIT_NAMES]);
    expect(result).toMatchObject({ uninstalled: true, services: "stopped" });
    expect(existsSync(paths.installedCommand)).toBe(false);
    expect(existsSync(paths.runtimeRoot)).toBe(false);
    expect(existsSync(paths.installFile)).toBe(false);
  });
});
