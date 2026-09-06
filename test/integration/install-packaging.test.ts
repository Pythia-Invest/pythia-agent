import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteJson } from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import { buildManagedSource } from "../../scripts/install/runtime.mjs";
import {
  renderUnits,
  installUnits,
  removeUnits,
  serviceAction,
  serviceEnvironments,
  serviceEnvironmentValues,
  UNIT_NAMES,
  verifyOwnedUnits,
  writeServiceEnvironment,
} from "../../scripts/install/systemd.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-packaging-test-"));
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
  const executables = {
    node: join(paths.runtimeRoot, "node", "22.16.0", "bin", "node"),
    python: join(paths.runtimeRoot, "python", "python3.12"),
    managedPython: join(paths.managedPython, ".venv", "bin", "python"),
    uv: join(paths.runtimeRoot, "uv", "0.9.28", "uv"),
    hermes: join(paths.hermesSource, ".venv", "bin", "hermes"),
    basicMemory: join(paths.managedPython, ".venv", "bin", "basic-memory"),
    next: join(
      repositoryRoot,
      "apps",
      "desk",
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    ),
  };
  return { executables, paths, root };
}

describe("installed packaging", () => {
  it("accepts only Ubuntu x86-64 with the qualified Git baseline", () => {
    const { root } = fixture();
    const ubuntu = join(root, "ubuntu-release");
    const debian = join(root, "debian-release");
    writeFileSync(ubuntu, "ID=ubuntu\n");
    writeFileSync(debian, "ID=debian\n");
    const command = join(repositoryRoot, "scripts", "install", "platform.sh");
    expect(() =>
      execFileSync(command, [ubuntu, "Linux", "x86_64", "2.43.0"]),
    ).not.toThrow();
    expect(() =>
      execFileSync(command, [debian, "Linux", "x86_64", "2.43.0"]),
    ).toThrow();
    expect(() =>
      execFileSync(command, [ubuntu, "Linux", "aarch64", "2.43.0"]),
    ).toThrow();
    expect(() =>
      execFileSync(command, [ubuntu, "Linux", "x86_64", "2.42.9"]),
    ).toThrow();
  });

  it("renders only the four loopback runtime units without host mutation", () => {
    const { executables, paths } = fixture();
    const units = renderUnits(paths, executables);
    expect(Object.keys(units).sort()).toEqual([...UNIT_NAMES].sort());
    const text = Object.values(units).join("\n");
    expect(text).toContain("127.0.0.1");
    expect(text).toContain("gateway run --external-supervisor");
    expect(text).not.toContain("Design Lab");
    expect(UNIT_NAMES).not.toContain("pythia-desk.service");
    expect(UNIT_NAMES).not.toContain("pythia.target");
    expect(text).not.toContain("pythia-desk.service");
    expect(paths.ports.hermes).toBe(8645);
    expect(text).not.toContain(".agents");
    expect(text).toContain(
      "UnsetEnvironment=API_SERVER_KEY EODHD_API_TOKEN EDGAR_IDENTITY",
    );
    expect(text).not.toContain("PRIVATE_BEARER");
    const hermesUnit = units["pythia-agent-hermes.service"] ?? "";
    expect(hermesUnit).toContain(`WorkingDirectory=${paths.workspace}\n`);
    expect(hermesUnit).not.toContain(`WorkingDirectory=${paths.checkout}\n`);
    const deskUnit = units["pythia-agent-desk.service"] ?? "";
    expect(deskUnit).toContain(
      `WorkingDirectory=${join(paths.checkout, "apps", "desk")}\n`,
    );
    expect(deskUnit).not.toContain(`WorkingDirectory=${paths.checkout}\n`);
    expect(deskUnit).not.toContain(".agents");
  });

  it("performs only the Desk build after shared runtime preparation", () => {
    const { executables, paths } = fixture();
    const commands: Array<{ command: string; args: string[]; path: string }> =
      [];
    buildManagedSource(paths, executables, {
      runCommand: (
        command: string,
        args: string[],
        options: { environment: NodeJS.ProcessEnv },
      ) => {
        commands.push({ command, args, path: options.environment.PATH ?? "" });
      },
    });
    expect(commands).toEqual([
      {
        command: "pnpm",
        args: ["--filter", "@pythia/desk", "build"],
        path: expect.stringMatching(
          new RegExp(`^${dirname(executables.node)}`),
        ),
      },
    ]);
  });

  it("suspends boot before stop and never dispatches a foreign lab unit", () => {
    const calls: string[][] = [];
    const systemctl = vi.fn((args: string[]) => {
      calls.push(args);
      if (args[0] === "is-enabled") return "disabled";
      if (args[0] === "is-active") return "inactive";
      return "";
    });
    serviceAction("stop", { systemctl });
    expect(calls.slice(0, 3)).toEqual([
      ["disable", "pythia-agent.target"],
      ["is-enabled", "pythia-agent.target"],
      ["stop", ...UNIT_NAMES],
    ]);
    expect(calls.map((args) => args.join(" ")).join("\n")).not.toMatch(
      /(^|\s)pythia-(desk|hermes|basic-memory)\.service($|\s)|(^|\s)pythia\.target($|\s)/u,
    );
  });

  it("installs and removes only the public-product units", () => {
    const { executables, paths } = fixture();
    mkdirSync(paths.unitRoot, { recursive: true, mode: 0o700 });
    const foreign = join(paths.unitRoot, "pythia-desk.service");
    writeFileSync(foreign, "[Unit]\nDescription=existing lab\n");
    installUnits(paths, renderUnits(paths, executables));
    removeUnits(paths);
    expect(readFileSync(foreign, "utf8")).toContain("existing lab");
    for (const name of UNIT_NAMES) {
      expect(existsSync(join(paths.unitRoot, name))).toBe(false);
    }
  });

  it("does not accept a residual failed unit as a confirmed stop", () => {
    expect(() =>
      serviceAction("stop", {
        systemctl: (args: string[]) => {
          if (args[0] === "is-enabled") return "disabled";
          if (args[0] === "is-active") {
            return args[1] === "pythia-agent-hermes.service"
              ? "failed"
              : "inactive";
          }
          return "";
        },
      }),
    ).toThrow("did not stop");
  });

  it("accepts a failed exit only after systemd confirms every process is gone", () => {
    const control = (group: string) => (args: string[]) => {
      if (args[0] === "is-enabled") return "disabled";
      if (args[0] === "is-active") return "failed";
      if (args.includes("--property=MainPID")) return "0";
      if (args.includes("--property=ControlPID")) return "0";
      if (args.includes("--property=ControlGroup")) return group;
      return "";
    };
    expect(() =>
      serviceAction("stop", { systemctl: control("") }),
    ).not.toThrow();
    expect(() =>
      serviceAction("stop", { systemctl: control("/remaining-processes") }),
    ).toThrow("did not stop");
  });

  it("keeps the bearer in secrets.json and out of every persistent service environment", () => {
    const { executables, paths } = fixture();
    const secret = "PRIVATE_BEARER";
    mkdirSync(paths.configRoot, { recursive: true, mode: 0o700 });
    atomicWriteJson(join(paths.configRoot, "secrets.json"), {
      schema_version: 1,
      hermes_api_key: secret,
    });
    writeFileSync(paths.serviceEnvironment, `API_SERVER_KEY="${secret}"\n`, {
      mode: 0o600,
    });
    writeServiceEnvironment(paths, secret, executables);
    const environments = serviceEnvironments(paths, executables);
    expect(JSON.stringify(environments)).not.toContain(secret);
    expect(JSON.stringify(environments)).not.toContain("API_SERVER_KEY");
    expect(environments.basicMemory).toContain(
      'BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED="false"',
    );
    expect(environments.desk).toContain('NEXT_TELEMETRY_DISABLED="1"');
    expect(environments.hermes).toContain('HERMES_DISABLE_LAZY_INSTALLS="1"');
    expect(environments.desk).toContain(
      `PYTHIA_LIFECYCLE_COMMAND="${paths.installedCommand}"`,
    );
    expect(environments.hermes).toContain(
      `PYTHIA_PYTHON="${executables.managedPython}"`,
    );
    expect(environments.desk).toContain(
      `PYTHIA_INSTALL_CONFIG_HOME="${resolve(paths.configRoot, "..")}"`,
    );
    expect(
      Object.keys(serviceEnvironmentValues(paths, executables).basicMemory),
    ).toEqual([
      "HOME",
      "BASIC_MEMORY_CONFIG_DIR",
      "BASIC_MEMORY_NO_PROMOS",
      "BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED",
      "FASTMCP_CHECK_FOR_UPDATES",
      "FASTMCP_SHOW_SERVER_BANNER",
      "HF_HOME",
      "FASTEMBED_CACHE_PATH",
      "XDG_CACHE_HOME",
      "PATH",
    ]);
    expect(existsSync(paths.serviceEnvironment)).toBe(false);
    expect(
      readFileSync(join(paths.configRoot, "secrets.json"), "utf8"),
    ).toContain(secret);
    for (const path of Object.values(paths.serviceEnvironments)) {
      expect(readFileSync(path, "utf8")).not.toContain(secret);
    }
  });

  it("verifies the exact active owned units without mutating the host", () => {
    const { executables, paths } = fixture();
    const units = renderUnits(paths, executables);
    const commands = {
      "pythia-agent-basic-memory.service": [
        executables.basicMemory,
        "mcp --transport streamable-http --host 127.0.0.1 --port 8643 --path /mcp --project production",
      ],
      "pythia-agent-hermes.service": [
        executables.python,
        `${paths.serviceLauncher} hermes ${executables.hermes} -p pythia gateway run --external-supervisor`,
      ],
      "pythia-agent-desk.service": [
        executables.python,
        `${paths.serviceLauncher} desk ${executables.node} ${executables.next} start --hostname 127.0.0.1 --port 8644`,
      ],
    } as const;
    const systemctl = vi.fn((args: string[]) => {
      if (args[0] === "is-enabled") return "enabled";
      if (args[0] === "is-active") return "active";
      const name = args[1] as keyof typeof commands | "pythia-agent.target";
      const property = args[2];
      if (property === "--property=FragmentPath") {
        return join(paths.unitRoot, name);
      }
      if (property === "--property=MainPID") return "1234";
      const command = commands[name as keyof typeof commands];
      return `{ path=${command[0]} ; argv[]=${command.join(" ")} ; ignore_errors=no ; }`;
    });
    expect(
      verifyOwnedUnits(paths, executables, {
        systemctl,
        readFile: (path: string) => units[path.split("/").at(-1) ?? ""],
      }),
    ).toMatchObject({ owned: true, units: expect.arrayContaining(UNIT_NAMES) });
  });
});
