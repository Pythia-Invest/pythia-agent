import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import { applyUpdate } from "../../scripts/update/apply.mjs";
import {
  installedUpdateStatus,
  startDeskUpdate,
  UPDATE_UNIT,
} from "../../scripts/update/desk-update.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function fixture(prerequisite = "// No additional target prerequisites.\n") {
  const root = mkdtempSync(join(tmpdir(), "pythia-desk-update-"));
  roots.push(root);
  const source = join(root, "source");
  mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.invalid");
  writeFileSync(join(source, "version"), "A");
  git(source, "add", ".");
  git(source, "commit", "-m", "A");
  const current = git(source, "rev-parse", "HEAD");
  const checkout = join(root, "checkout");
  git(root, "clone", source, checkout);
  mkdirSync(join(source, "scripts", "update"), { recursive: true });
  mkdirSync(join(source, "runtime"));
  writeFileSync(join(source, "runtime", "fixture.txt"), "synthetic release");
  writeFileSync(
    join(source, "scripts", "update", "prerequisites.mjs"),
    prerequisite,
  );
  writeFileSync(join(source, "version"), "B");
  git(source, "add", ".");
  git(source, "commit", "-m", "B");
  const target = git(source, "rev-parse", "HEAD");
  const paths = resolveInstallPaths({
    HOME: join(root, "home"),
    PYTHIA_CHECKOUT: checkout,
  });
  atomicWriteJson(paths.installFile, {
    schema_version: 1,
    checkout,
    revision: current,
    source: { update_safe: true },
  });
  atomicWriteJson(paths.releaseFile, { channel: "preview" });
  const systemctl = vi.fn(() => "inactive");
  const spawnSync = vi.fn(() => ({ status: 0 }));
  return {
    root,
    source,
    checkout,
    paths,
    current,
    target,
    systemctl,
    spawnSync,
  };
}

describe("Desk delegates updates to the installed lifecycle", () => {
  it("returns target prerequisites before handing off or changing the live source", () => {
    const f = fixture(
      'console.error("Migration required"); process.exitCode = 1;',
    );
    expect(
      startDeskUpdate(
        f.paths,
        { current: f.current, target: f.target },
        {
          systemctl: f.systemctl,
          spawnSync: f.spawnSync,
        },
      ),
    ).toMatchObject({ started: false, code: "target_prerequisites_pending" });
    expect(f.spawnSync).not.toHaveBeenCalled();
    expect(git(f.checkout, "rev-parse", "HEAD")).toBe(f.current);
  });

  it("reads local activation and starts one fixed independent user service without passing secrets", () => {
    const f = fixture();
    expect(installedUpdateStatus(f.paths, f.systemctl)).toMatchObject({
      current_revision: f.current,
      current_version: "main",
      updater: "idle",
      apply_supported: true,
    });
    expect(
      startDeskUpdate(
        f.paths,
        { current: f.current, target: f.target },
        {
          systemctl: f.systemctl,
          spawnSync: f.spawnSync,
          environment: {
            HOME: "/another/home",
            PATH: "/usr/bin",
            API_SERVER_KEY: "PRIVATE",
          },
        },
      ),
    ).toEqual({ started: true, target_revision: f.target });
    expect(f.spawnSync).toHaveBeenCalledOnce();
    const call = f.spawnSync.mock.calls[0] as unknown as [
      string,
      string[],
      unknown,
    ];
    expect(call[0]).toBe("systemd-run");
    expect(call[1]).toEqual(
      expect.arrayContaining([
        "--user",
        `--unit=${UPDATE_UNIT}`,
        "--property=Type=exec",
        f.paths.installedCommand,
        "update",
        "--expect-current",
        f.current,
        "--expect-target",
        f.target,
      ]),
    );
    expect(JSON.stringify(call)).not.toContain("PRIVATE");
    expect(call[1].some((value) => value.includes("PartOf"))).toBe(false);
  });

  it("rejects running, dirty and changed-target attempts before launching anything", () => {
    const f = fixture();
    const expected = { current: f.current, target: f.target };
    expect(
      startDeskUpdate(f.paths, expected, {
        systemctl: () => "active",
        spawnSync: f.spawnSync,
      }),
    ).toMatchObject({ started: false, code: "update_running" });
    expect(
      startDeskUpdate(f.paths, { ...expected, target: "c".repeat(40) }, f),
    ).toMatchObject({ started: false, code: "release_changed" });
    writeFileSync(join(f.checkout, "user-change"), "keep me");
    expect(startDeskUpdate(f.paths, expected, f)).toMatchObject({
      started: false,
      code: "dirty_checkout",
    });
    expect(f.spawnSync).not.toHaveBeenCalled();
  });

  it("reports missing service manager and launch failures; only clears a failed unit", () => {
    const f = fixture();
    const expected = { current: f.current, target: f.target };
    const missing = () => {
      throw new Error("no bus");
    };
    expect(installedUpdateStatus(f.paths, missing)).toMatchObject({
      apply_supported: false,
      updater: "unavailable",
    });
    expect(
      startDeskUpdate(f.paths, expected, {
        systemctl: missing,
        spawnSync: f.spawnSync,
      }),
    ).toMatchObject({ started: false, code: "update_service_unavailable" });
    const failed = vi.fn((args: string[]) =>
      args[0] === "show" ? "failed" : "",
    );
    expect(
      startDeskUpdate(f.paths, expected, {
        systemctl: failed,
        spawnSync: () => ({ status: 1 }),
      }),
    ).toMatchObject({ started: false, code: "update_start_failed" });
    expect(failed).toHaveBeenCalledWith(["reset-failed", UPDATE_UNIT]);
  });

  it("rechecks the selected target inside the locked updater before stop or source mutation", async () => {
    const f = fixture();
    const stop = vi.fn();
    await expect(
      applyUpdate(f.paths, {
        expectedCurrent: f.current,
        expectedTarget: "c".repeat(40),
        stop,
      }),
    ).rejects.toMatchObject({ code: "release_changed" });
    expect(stop).not.toHaveBeenCalled();
    expect(git(f.checkout, "rev-parse", "HEAD")).toBe(f.current);
    // A remote that moved back to the installed build is still a changed selection.
    git(f.source, "reset", "--hard", f.current);
    await expect(
      applyUpdate(f.paths, {
        expectedCurrent: f.current,
        expectedTarget: f.target,
        stop,
      }),
    ).rejects.toMatchObject({ code: "release_changed" });
    expect(stop).not.toHaveBeenCalled();
  });
});
