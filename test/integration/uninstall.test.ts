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
import { uninstall } from "../../scripts/uninstall/uninstall.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

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
              name === "pythia-agent-hermes.service" ? "active" : "inactive",
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
          unitState: () => "inactive",
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
    expect(inspected).toEqual(UNIT_NAMES);
    expect(result).toMatchObject({ uninstalled: true, services: "stopped" });
    expect(existsSync(paths.installedCommand)).toBe(false);
    expect(existsSync(paths.runtimeRoot)).toBe(false);
    expect(existsSync(paths.installFile)).toBe(false);
  });
});
