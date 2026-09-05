import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recoverInstalledInitialization } from "../../scripts/install/cli.mjs";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import { installDevice } from "../../scripts/install/runtime.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-install-recovery-"));
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
    paths.profileRoot,
    paths.stateRoot,
    paths.workspace,
    paths.knowledge,
  ]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  writeFileSync(join(paths.profileRoot, "partial"), "native scaffold\n");
  writeFileSync(join(paths.hermesRoot, "auth.json"), "root credential\n");
  writeFileSync(join(paths.workspace, "owned.md"), "workspace\n");
  writeFileSync(join(paths.knowledge, "owned.md"), "knowledge\n");
  return { paths, root };
}

function receipt(paths: ReturnType<typeof fixture>["paths"], status: string) {
  atomicWriteJson(paths.profileInitialization, {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    profile: paths.profile,
    hermes_root: paths.hermesRoot,
    state_root: paths.stateRoot,
    profile_initially_absent: true,
    status,
  });
}

describe("installed profile initialization recovery", () => {
  it("removes only the receipt-owned partial profile and permits the exact retry", async () => {
    const { paths } = fixture();
    receipt(paths, "native-profile-created");

    expect(recoverInstalledInitialization(paths, "preview")).toMatchObject({
      recovered: true,
      removed_profile: paths.profileRoot,
      preserved_credential_root: paths.hermesRoot,
      next: "./install.sh --preview",
    });
    expect(existsSync(paths.profileRoot)).toBe(false);
    expect(existsSync(paths.profileInitialization)).toBe(false);
    expect(readFileSync(join(paths.hermesRoot, "auth.json"), "utf8")).toBe(
      "root credential\n",
    );
    expect(readFileSync(join(paths.workspace, "owned.md"), "utf8")).toBe(
      "workspace\n",
    );
    expect(readFileSync(join(paths.knowledge, "owned.md"), "utf8")).toBe(
      "knowledge\n",
    );
    expect(existsSync(paths.installFile)).toBe(false);

    await expect(
      installDevice(paths, "preview", {
        expectedRevision: "a".repeat(40),
        stop: async () => undefined,
        prepare: async () => ({ revision: "a".repeat(40) }),
        startAndVerify: async () => undefined,
        enable: async () => undefined,
        ensureLinger: async () => ({ enabled: true, changed: false }),
        verifySource: async () => undefined,
      }),
    ).resolves.toMatchObject({ installed: true, channel: "preview" });
    expect(existsSync(paths.installFile)).toBe(true);
    expect(readFileSync(join(paths.workspace, "owned.md"), "utf8")).toBe(
      "workspace\n",
    );
    expect(readFileSync(join(paths.knowledge, "owned.md"), "utf8")).toBe(
      "knowledge\n",
    );
  });

  it("refuses ambiguous and foreign ownership without deleting state", () => {
    const ambiguous = fixture().paths;
    receipt(ambiguous, "started");
    expect(() => recoverInstalledInitialization(ambiguous, "preview")).toThrow(
      /ownership is ambiguous.*Refusing to delete/u,
    );
    expect(existsSync(join(ambiguous.profileRoot, "partial"))).toBe(true);

    const foreign = fixture().paths;
    receipt(foreign, "native-profile-created");
    const value = JSON.parse(
      readFileSync(foreign.profileInitialization, "utf8"),
    );
    atomicWriteJson(foreign.profileInitialization, {
      ...value,
      repository: "/foreign/checkout",
    });
    expect(() => recoverInstalledInitialization(foreign, "preview")).toThrow(
      /does not belong/u,
    );
    expect(existsSync(join(foreign.profileRoot, "partial"))).toBe(true);
  });

  it("routes recovery through install.sh's lock before installation metadata exists", () => {
    const root = mkdtempSync(join(tmpdir(), "pythia-install-shell-recovery-"));
    roots.push(root);
    const dataHome = join(root, "data");
    const stateHome = join(root, "state");
    const fakeBin = join(root, "fake-bin");
    const marker = join(root, "node-arguments");
    const flockMarker = join(root, "flock-acquired");
    const node = join(dataHome, "pythia/runtime/node/22.16.0/bin/node");
    mkdirSync(join(dataHome, "pythia/runtime/node/22.16.0/bin"), {
      recursive: true,
      mode: 0o700,
    });
    mkdirSync(fakeBin, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(fakeBin, "flock"),
      '#!/bin/sh\n[ "$PYTHIA_TEST_FLOCK_FAIL" != 1 ] || exit 1\n: > "$PYTHIA_TEST_FLOCK_MARKER"\n',
      { mode: 0o700 },
    );
    writeFileSync(
      node,
      '#!/bin/sh\n[ -f "$PYTHIA_TEST_FLOCK_MARKER" ] || exit 91\nprintf \'%s\\n\' "$@" > "$PYTHIA_TEST_MARKER"\n',
      { mode: 0o700 },
    );
    chmodSync(node, 0o700);

    const environment = {
      HOME: join(root, "home"),
      PATH: `${fakeBin}:/usr/bin:/bin`,
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      XDG_DATA_HOME: dataHome,
      XDG_STATE_HOME: stateHome,
      XDG_CACHE_HOME: join(root, "xdg-cache"),
      PYTHIA_INSTALL_CONFIG_HOME: join(root, "install-config"),
      PYTHIA_INSTALL_DATA_HOME: dataHome,
      PYTHIA_INSTALL_STATE_HOME: stateHome,
      PYTHIA_INSTALL_CACHE_HOME: join(root, "install-cache"),
      PYTHIA_INSTALL_BIN_HOME: join(root, "install-bin"),
      PYTHIA_INSTALL_SYSTEMD_HOME: join(root, "install-units"),
      PYTHIA_TEST_MARKER: marker,
      PYTHIA_TEST_FLOCK_MARKER: flockMarker,
    };

    execFileSync(
      join(repositoryRoot, "install.sh"),
      ["--recover-initialization", "--preview"],
      {
        env: environment,
      },
    );

    expect(readFileSync(marker, "utf8").trim().split("\n")).toEqual([
      join(repositoryRoot, "scripts/install/cli.mjs"),
      "recover-initialization",
      "--channel",
      "preview",
    ]);
    expect(existsSync(join(stateHome, "pythia", "installation.json"))).toBe(
      false,
    );
    expect(existsSync(join(stateHome, "pythia", "lifecycle.lock"))).toBe(true);
    expect(existsSync(flockMarker)).toBe(true);

    rmSync(marker);
    expect(() =>
      execFileSync(
        join(repositoryRoot, "install.sh"),
        ["--recover-initialization", "--preview"],
        { env: { ...environment, PYTHIA_TEST_FLOCK_FAIL: "1" } },
      ),
    ).toThrow();
    expect(existsSync(marker)).toBe(false);
  });
});
