import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import {
  assertLegacyBasicMemoryOwned,
  legacyBasicMemoryUnit,
} from "../../scripts/install/legacy-basic-memory.mjs";
import { retireLegacyBasicMemory } from "../../scripts/install/systemd.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-unit-retirement-"));
  roots.push(root);
  const paths = resolveInstallPaths({
    HOME: root,
    PYTHIA_INSTALL_SYSTEMD_HOME: join(root, "units"),
  });
  mkdirSync(paths.unitRoot, { recursive: true });
  const file = join(paths.unitRoot, "pythia-agent-basic-memory.service");
  writeFileSync(file, legacyBasicMemoryUnit(paths));
  const control = vi.fn((args: string[]) => {
    if (args.includes("--property=FragmentPath")) return file;
    if (
      args.includes("--property=MainPID") ||
      args.includes("--property=ControlPID")
    )
      return "0";
    if (args[0] === "is-active") return "inactive";
    return "";
  });
  return { paths, file, control };
}
describe("explicit legacy service retirement", () => {
  it("removes only an exactly owned stopped unit and preserves notes/config/environment", () => {
    const { paths, file, control } = fixture();
    mkdirSync(paths.knowledge, { recursive: true });
    mkdirSync(paths.basicMemoryConfig, { recursive: true });
    writeFileSync(join(paths.knowledge, "research.md"), "user research");
    writeFileSync(paths.legacyBasicMemoryEnvironment, "legacy environment");
    expect(retireLegacyBasicMemory(paths, { systemctl: control })).toEqual({
      retired: true,
    });
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(paths.knowledge, "research.md"), "utf8")).toBe(
      "user research",
    );
    expect(readFileSync(paths.legacyBasicMemoryEnvironment, "utf8")).toBe(
      "legacy environment",
    );
    expect(control.mock.calls.filter(([args]) => args[0] === "stop")).toEqual([
      [["stop", "pythia-agent-basic-memory.service"]],
    ]);
  });
  it.each(["customized", "drop-in", "foreign", "live"])(
    "preserves a %s unit",
    (kind) => {
      const { paths, file, control } = fixture();
      if (kind === "customized")
        writeFileSync(file, `${readFileSync(file, "utf8")}# local change\n`);
      const original = readFileSync(file, "utf8");
      const query = vi.fn((args: string[]) => {
        if (kind === "drop-in" && args.includes("--property=DropInPaths"))
          return "/user/override.conf";
        if (kind === "foreign" && args.includes("--property=FragmentPath"))
          return "/other/unit.service";
        if (kind === "live" && args.includes("--property=ControlGroup"))
          return "/remaining";
        return control(args);
      });
      expect(() =>
        retireLegacyBasicMemory(paths, { systemctl: query }),
      ).toThrow();
      expect(readFileSync(file, "utf8")).toBe(original);
      expect(query.mock.calls.some(([args]) => args[0] === "disable")).toBe(
        false,
      );
      if (kind !== "live")
        expect(query.mock.calls.some(([args]) => args[0] === "stop")).toBe(
          false,
        );
    },
  );
  it("admits genuine absence but rejects a foreign loaded fragment", () => {
    const { paths, file } = fixture();
    rmSync(file);
    expect(assertLegacyBasicMemoryOwned(paths, () => "")).toEqual({
      present: false,
    });
    expect(() =>
      assertLegacyBasicMemoryOwned(paths, () => "/foreign/service"),
    ).toThrow(/fragment/);
    expect(() => assertLegacyBasicMemoryOwned(paths, () => file)).toThrow(
      /unowned/,
    );
  });
  it("recovers a failed reload using exact retirement evidence", () => {
    const { paths, file, control } = fixture();
    let failReload = true;
    let loaded = true;
    const query = vi.fn((args: string[]) => {
      if (args[0] === "daemon-reload") {
        if (failReload) throw new Error("reload interrupted");
        loaded = false;
      }
      if (args.includes("--property=FragmentPath")) return loaded ? file : "";
      if (args.includes("--property=ExecStart")) {
        const exe = join(paths.managedPython, ".venv", "bin", "basic-memory");
        return `{ path=${exe} ; argv[]=${exe} mcp --transport streamable-http --host 127.0.0.1 --port 8643 --path /mcp --project production ; }`;
      }
      return control(args);
    });
    expect(() => retireLegacyBasicMemory(paths, { systemctl: query })).toThrow(
      "reload interrupted",
    );
    expect(existsSync(file)).toBe(false);
    expect(
      readFileSync(
        join(paths.unitRoot, ".pythia-workspace-basic-memory.retired"),
        "utf8",
      ),
    ).toBe(legacyBasicMemoryUnit(paths));
    expect(assertLegacyBasicMemoryOwned(paths, query)).toEqual({
      present: false,
    });
    const changedCommand = (args: string[]) =>
      args.includes("--property=ExecStart") ? "unexpected" : query(args);
    expect(() =>
      retireLegacyBasicMemory(paths, { systemctl: changedCommand }),
    ).toThrow(/unexpected loaded command/);
    failReload = false;
    expect(retireLegacyBasicMemory(paths, { systemctl: query })).toEqual({
      retired: true,
    });
    expect(retireLegacyBasicMemory(paths, { systemctl: query })).toEqual({
      retired: false,
      reason: "absent",
    });
    expect(
      query.mock.calls.filter(([args]) => args[0] === "stop"),
    ).toHaveLength(1);
  });
  it("rechecks ownership after stop before removing a changed unit", () => {
    const { paths, file, control } = fixture();
    const query = (args: string[]) => {
      if (args[0] === "stop") writeFileSync(file, "changed while stopping");
      return control(args);
    };
    expect(() => retireLegacyBasicMemory(paths, { systemctl: query })).toThrow(
      /customized/,
    );
    expect(readFileSync(file, "utf8")).toBe("changed while stopping");
  });
});
