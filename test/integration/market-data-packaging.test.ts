import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildManagedWidgets } from "../../scripts/dev/build-managed-widgets.mjs";
import { MANAGED_WIDGET_BUILDS } from "../../scripts/dev/managed-widget-builds.mjs";
import {
  MANAGED_PLUGINS,
  managedRunnerBuilds,
  refreshManagedPlugins,
} from "../../scripts/dev/managed-plugins.mjs";
import { PLUGIN_COPY_RECEIPT } from "../../scripts/dev/files.mjs";

const repository = new URL("../../", import.meta.url).pathname;
const runnerBuilds = managedRunnerBuilds(MANAGED_PLUGINS);
// Compiled once per file into a private directory, so no other test shares
// (or races on) the checkout's runner output.
const runnerOutput = mkdtempSync(join(tmpdir(), "pythia-runner-dist-"));
// Packaging consumes actual compiled release inputs, just like explicit runtime
// preparation. Never rely on committed bundles or a previous contributor build.
beforeAll(async () => {
  execFileSync(process.execPath, [
    join(repository, "node_modules/typescript/bin/tsc"),
    "--project",
    join(repository, "runtime/managed/runner/tsconfig.json"),
    "--outDir",
    runnerOutput,
  ]);
  await buildManagedWidgets(repository);
}, 60_000);
afterAll(() => rmSync(runnerOutput, { recursive: true, force: true }));
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
    for (const file of files) {
      mkdirSync(dirname(join(managedRoot, source, file)), { recursive: true });
      copyFileSync(
        join(repository, "runtime/managed", source, file),
        join(managedRoot, source, file),
      );
    }
  }
  const dist = "runtime/managed/runner/dist/";
  for (const path of runnerBuilds.flatMap(({ entry, output }) =>
    output ? [entry, output] : [entry],
  )) {
    const destination = join(managedRoot, path.replace("runtime/managed/", ""));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(
      path.startsWith(dist)
        ? join(runnerOutput, path.slice(dist.length))
        : join(repository, path),
      destination,
    );
  }
  return {
    root,
    profile,
    profileRoot,
    managedRoot,
    managedCore: join(managedRoot, "core"),
  };
}

describe("native market-data lifecycle payload", () => {
  it("copies allowlisted nested inputs and preserves native choices and plugin state", () => {
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
    for (const { source } of MANAGED_PLUGINS) {
      mkdirSync(join(paths.managedRoot, source, "__pycache__"));
      writeFileSync(
        join(paths.managedRoot, source, "AGENTS.md"),
        "builder-only",
      );
    }
    refreshManagedPlugins(paths, "synthetic", { execute });
    for (const { source, name, files } of MANAGED_PLUGINS) {
      const destination = join(paths.profileRoot, "plugins", name);
      expect(
        readdirSync(destination, { recursive: true })
          .filter((name) => lstatSync(join(destination, String(name))).isFile())
          .sort(),
      ).toEqual([...files, PLUGIN_COPY_RECEIPT].sort());
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
    expect(commands.map((args) => args[3])).toEqual(["doctor"]);
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
      "enable",
      "enable",
      "enable",
      "enable",
      "enable",
      "enable",
      "enable",
      "enable",
      "enable",
    ]);
    expect(
      commands.filter((args) => args[3] === "doctor").map((args) => args[4]),
    ).toEqual([join(paths.profileRoot, "plugins", "pythia")]);
    expect(commands.slice(1).map((args) => args[4])).toEqual([
      "pythia",
      "pythia-market-data",
      "pythia-yahoo-discovery",
      "pythia-sec",
      "pythia-openfigi",
      "pythia-gleif",
      "pythia-xbrl-filings",
      "pythia-coingecko",
      "pythia-coinmarketcap",
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
    const reports: string[] = [];
    expect(
      refreshManagedPlugins(paths, "synthetic", {
        execute,
        report: (message: string) => reports.push(message),
      })[0]?.status,
    ).toBe("preserved");
    expect(reports[0]).toContain("Preserved local plugin pythia");
    expect(readFileSync(join(foreign, "keep"), "utf8")).toBe("untouched");
  });

  it.each([
    ["widget", MANAGED_WIDGET_BUILDS[0]?.output],
    ["connector worker", runnerBuilds.find(({ output }) => output)?.output],
  ])(
    "requires explicit %s compilation before any package is replaced",
    (_kind, output) => {
      if (!output) throw Error("Missing managed build output.");
      const paths = fixture();
      rmSync(join(paths.managedRoot, output.replace("runtime/managed/", "")));
      const commands: string[][] = [];
      expect(() =>
        refreshManagedPlugins(paths, "synthetic", {
          execute: (_paths: unknown, args: string[]) => {
            commands.push(args);
          },
        }),
      ).toThrow();
      expect(commands).toEqual([]);
      expect(existsSync(join(paths.profileRoot, "plugins"))).toBe(false);
    },
  );

  it("installs optional payloads without enabling them and leaves omitted/community plugins alone", () => {
    const paths = fixture();
    const community = join(paths.profileRoot, "plugins", "community");
    mkdirSync(community, { recursive: true });
    writeFileSync(join(community, "plugin.yaml"), "name: community\n");
    const commands: string[][] = [];
    const core = MANAGED_PLUGINS.find((plugin) => plugin.name === "pythia");
    if (!core) throw new Error("Missing core payload fixture");
    const payloads = [
      ...MANAGED_PLUGINS,
      {
        ...core,
        name: "optional",
        doctor: false,
        enabledByDefault: false,
      },
      {
        ...core,
        name: "not-installed",
        install: false,
        source: "does-not-exist",
      },
    ];
    refreshManagedPlugins(paths, "synthetic", {
      freshProfile: true,
      payloads,
      execute: (_paths: unknown, args: string[]) => {
        commands.push(args);
      },
    });
    expect(
      existsSync(join(paths.profileRoot, "plugins/optional/plugin.yaml")),
    ).toBe(true);
    expect(existsSync(join(paths.profileRoot, "plugins/not-installed"))).toBe(
      false,
    );
    expect(
      commands.filter((args) => args[3] === "enable").map((args) => args[4]),
    ).toEqual([
      "pythia",
      "pythia-market-data",
      "pythia-yahoo-discovery",
      "pythia-sec",
      "pythia-openfigi",
      "pythia-gleif",
      "pythia-xbrl-filings",
      "pythia-coingecko",
      "pythia-coinmarketcap",
    ]);
    expect(readFileSync(join(community, "plugin.yaml"), "utf8")).toBe(
      "name: community\n",
    );
    commands.length = 0;
    refreshManagedPlugins(paths, "synthetic", {
      payloads,
      execute: (_paths: unknown, args: string[]) => {
        commands.push(args);
      },
    });
    expect(
      commands.some((args) => args[3] === "enable" || args[3] === "disable"),
    ).toBe(false);
  });

  it("reports a user replacement without doctoring, enabling or claiming its ownership", () => {
    const paths = fixture();
    const destination = join(paths.profileRoot, "plugins/pythia");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "plugin.yaml"), "name: user-replacement\n");
    const commands: string[][] = [];
    const reports: string[] = [];
    const result = refreshManagedPlugins(paths, "synthetic", {
      freshProfile: true,
      report: (message: string) => reports.push(message),
      execute: (_paths: unknown, args: string[]) => {
        commands.push(args);
      },
    });
    expect(result[0]?.status).toBe("preserved");
    expect(reports[0]).toContain("unreceipted");
    expect(
      commands.some((args) => args[4] === "pythia" || args[4] === destination),
    ).toBe(false);
    expect(existsSync(join(destination, PLUGIN_COPY_RECEIPT))).toBe(false);
    expect(readFileSync(join(destination, "plugin.yaml"), "utf8")).toBe(
      "name: user-replacement\n",
    );
  });

  it("preserves edited widget source, prebuilt modules and legacy HTML files", () => {
    const paths = fixture();
    refreshManagedPlugins(paths, "synthetic", { execute: () => {} });
    const feature = join(paths.profileRoot, "plugins", "pythia-market-data");
    const source = join(feature, "widgets/instrument-table.tsx");
    const module = join(feature, "dist/widgets/instruments.mjs");
    const html = join(feature, "widgets/legacy.html");
    writeFileSync(source, "export default function Custom() { return null; }");
    writeFileSync(module, "export const userOwned = true;");
    writeFileSync(html, "<p>Existing custom view</p>");
    const result = refreshManagedPlugins(paths, "synthetic", {
      execute: () => {},
      report: () => {},
    });
    expect(
      result.find((plugin) => plugin.name === "pythia-market-data")?.status,
    ).toBe("preserved");
    expect(readFileSync(source, "utf8")).toContain("function Custom");
    expect(readFileSync(module, "utf8")).toBe("export const userOwned = true;");
    expect(readFileSync(html, "utf8")).toBe("<p>Existing custom view</p>");
  });
});
