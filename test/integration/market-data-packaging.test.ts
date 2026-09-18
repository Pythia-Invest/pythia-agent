import {
  copyFileSync,
  existsSync,
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
  MANAGED_PLUGINS,
  refreshManagedPlugins,
} from "../../scripts/dev/managed-plugins.mjs";

const repository = new URL("../../", import.meta.url).pathname;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(profile = "fixture") {
  const root = mkdtempSync(join(tmpdir(), "pythia-plugin-copy-"));
  roots.push(root);
  const managedRoot = join(root, "managed");
  const profileRoot = join(root, profile);
  mkdirSync(profileRoot);
  for (const { source, files } of MANAGED_PLUGINS) {
    mkdirSync(join(managedRoot, source), { recursive: true });
    for (const file of files)
      copyFileSync(
        join(repository, "runtime/managed", source, file),
        join(managedRoot, source, file),
      );
  }
  return {
    root,
    profile,
    profileRoot,
    managedRoot,
    managedPlugin: join(managedRoot, "plugin"),
  };
}

describe("native market-data lifecycle payload", () => {
  it("copies all installed helpers exactly, removes stale copies and preserves native choices/state", () => {
    const paths = fixture("profile with spaces");
    const config = `plugins:
  enabled: [pythia]
  disabled: [pythia-market-data]
  entries:
    pythia-market-data:
      settings: {}
platform_toolsets:
  api_server: []
`;
    // The namespace is supplied by native PluginState; this fixture does not
    // reproduce Hermes' namespace derivation algorithm.
    const nativeNamespace = "synthetic-native-namespace";
    writeFileSync(join(paths.profileRoot, "config.yaml"), config);
    mkdirSync(join(paths.profileRoot, "plugin-data", nativeNamespace), {
      recursive: true,
    });
    writeFileSync(
      join(paths.profileRoot, "plugin-data", nativeNamespace, "state"),
      "user-owned",
    );
    const commands: string[][] = [];
    const execute = (_paths: unknown, args: string[]) => {
      commands.push(args);
    };
    for (const { source, name } of MANAGED_PLUGINS) {
      mkdirSync(join(paths.managedRoot, source, "__pycache__"));
      writeFileSync(
        join(paths.managedRoot, source, "AGENTS.md"),
        "builder-only",
      );
      const destination = join(paths.profileRoot, "plugins", name);
      mkdirSync(destination, { recursive: true });
      writeFileSync(join(destination, "obsolete.py"), "stale");
    }
    refreshManagedPlugins(paths, "synthetic", { execute });
    for (const { source, name, files } of MANAGED_PLUGINS) {
      const destination = join(paths.profileRoot, "plugins", name);
      expect(readdirSync(destination).sort()).toEqual([...files].sort());
      for (const file of files)
        expect(readFileSync(join(destination, file))).toEqual(
          readFileSync(join(paths.managedRoot, source, file)),
        );
    }
    expect(readFileSync(join(paths.profileRoot, "config.yaml"), "utf8")).toBe(
      config,
    );
    expect(
      readFileSync(
        join(paths.profileRoot, "plugin-data", nativeNamespace, "state"),
        "utf8",
      ),
    ).toBe("user-owned");
    expect(commands.map((args) => args[3])).toEqual(["doctor", "doctor"]);
    expect(commands.every((args) => args[1] === paths.profile)).toBe(true);
  });

  it("validates the complete copied payload before enabling fresh profiles", () => {
    const paths = fixture();
    const commands: string[][] = [];
    refreshManagedPlugins(paths, "synthetic", {
      freshProfile: true,
      execute: (_paths: unknown, args: string[]) => {
        // Native validation begins only after the complete set is copied.
        expect(
          existsSync(
            join(paths.profileRoot, "plugins", "pythia-market-data", "wire.py"),
          ),
        ).toBe(true);
        commands.push(args);
      },
    });
    expect(commands.map((args) => args[3])).toEqual([
      "doctor",
      "doctor",
      "enable",
      "enable",
    ]);
    expect(
      commands.filter((args) => args[3] === "doctor").map((args) => args[4]),
    ).toEqual([
      join(paths.profileRoot, "plugins", "pythia"),
      join(paths.profileRoot, "plugins", "pythia-market-data"),
    ]);
    expect(commands.slice(2).map((args) => args[4])).toEqual([
      "pythia",
      "pythia-market-data",
    ]);
    const failed: string[][] = [];
    expect(() =>
      refreshManagedPlugins(paths, "synthetic", {
        freshProfile: true,
        execute: (_paths: unknown, args: string[]) => {
          failed.push(args);
          throw new Error("doctor rejected");
        },
      }),
    ).toThrow("doctor rejected");
    expect(failed.every((args) => args[3] === "doctor")).toBe(true);
  });

  it("rejects missing/symlinked inputs before any copy and never follows a destination symlink", () => {
    const paths = fixture();
    const core = join(paths.profileRoot, "plugins", "pythia");
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, "marker"), "previous");
    const wire = join(paths.managedRoot, "plugins/market-data/wire.py");
    rmSync(wire);
    const execute = () => {
      throw new Error("must not run native commands");
    };
    expect(() =>
      refreshManagedPlugins(paths, "synthetic", { execute }),
    ).toThrow();
    expect(readFileSync(join(core, "marker"), "utf8")).toBe("previous");
    symlinkSync(
      join(paths.managedRoot, "plugins/market-data/wire_schema.py"),
      wire,
    );
    expect(() =>
      refreshManagedPlugins(paths, "synthetic", { execute }),
    ).toThrow(/regular file/u);
    expect(readFileSync(join(core, "marker"), "utf8")).toBe("previous");
    rmSync(wire);
    copyFileSync(
      join(repository, "runtime/managed/plugins/market-data/wire.py"),
      wire,
    );
    rmSync(core, { recursive: true });
    const foreign = join(paths.root, "foreign");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "keep"), "untouched");
    symlinkSync(foreign, core);
    expect(() =>
      refreshManagedPlugins(paths, "synthetic", { execute }),
    ).toThrow(/symlinked/u);
    expect(readFileSync(join(foreign, "keep"), "utf8")).toBe("untouched");
  });
});
