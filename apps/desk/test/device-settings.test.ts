import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDeviceSettingsService,
  DeviceSettingsError,
  lifecycleCommandEnvironment,
} from "@/server/device-settings";
import { defaultRestart, withFileLock } from "@/server/device-settings-native";
import { atomicWriteStore, requireStore } from "@/server/device-settings-store";
import type { HermesClient, HermesSkill, HermesToolset } from "@/server/types";
import { capturedCli } from "./hermes-capture";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "pythia-settings-"));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function harness(
  options: {
    authStatuses?: Record<string, "logged in" | "logged out">;
    authOutput?: string;
    commandFailure?: boolean;
    configRoot?: string;
    profile?: string;
    readbackLoss?: boolean;
    restart?: () => Promise<void>;
    workspaceRoot?: string;
    nativeCwd?: unknown;
    cwdUnavailable?: boolean;
  } = {},
) {
  const configRoot = options.configRoot ?? temporaryRoot();
  const stateRoot = join(configRoot, "state");
  const commandCalls: string[][] = [];
  let storedDisabled = new Set<string>(["investment-memory"]);
  let effectiveDisabled = new Set(storedDisabled);
  const platformToolsets = {
    api_server: new Set(["research-tools"]),
    discord: new Set(["custom-prices", "research-tools"]),
  };
  let effectiveTools = new Set(platformToolsets.api_server);
  const allSkills: HermesSkill[] = [
    {
      name: "research-notes",
      description: "Local override chosen by Hermes",
      category: "finance",
    },
    { name: "daily-observations", description: "Daily observations" },
    { name: "my-local-skill", description: "Local helper" },
  ];
  const allToolsets: HermesToolset[] = [
    {
      name: "research-tools",
      label: "Research tools",
      enabled: true,
      configured: true,
      tools: ["read_research"],
    },
    {
      name: "custom-prices",
      label: "Custom prices",
      enabled: false,
      configured: false,
      tools: ["read_prices"],
    },
  ];
  const client = {
    listSkills: vi.fn(async () =>
      allSkills.filter((skill) => !effectiveDisabled.has(skill.name)),
    ),
    listToolsets: vi.fn(async () =>
      allToolsets.map((item) => ({
        ...item,
        enabled: effectiveTools.has(item.name),
      })),
    ),
  } as unknown as HermesClient;
  const command = vi.fn(async (args: string[]) => {
    commandCalls.push([...args]);
    if (options.commandFailure && args.includes("set")) {
      throw new DeviceSettingsError(
        "Hermes rejected the native settings change.",
        502,
        "hermes_command_failed",
      );
    }
    if (args[2] === "auth") {
      if (options.authOutput !== undefined)
        return { stdout: options.authOutput };
      const provider = args[4] ?? "openai-codex";
      const status = options.authStatuses?.[provider] ?? "logged out";
      return { stdout: `${provider}: ${status}\n` };
    }
    if (args.includes("terminal.cwd")) {
      if (options.cwdUnavailable) throw new Error("Native cwd unavailable");
      return { stdout: JSON.stringify(options.nativeCwd ?? null) };
    }
    if (args.includes("config") && args.includes("get")) {
      return { stdout: JSON.stringify([...storedDisabled].sort()) };
    }
    if (args.includes("config") && args.includes("set")) {
      storedDisabled = new Set(JSON.parse(args.at(-1) ?? "[]") as string[]);
      return { stdout: "saved" };
    }
    const action = args[3];
    const name = args[4] ?? "";
    if (args[2] === "tools" && action === "enable")
      platformToolsets.api_server.add(name);
    if (args[2] === "tools" && action === "disable")
      platformToolsets.api_server.delete(name);
    return { stdout: "ok" };
  });
  const restart = vi.fn(async () => {
    await options.restart?.();
    if (!options.readbackLoss) {
      effectiveDisabled = new Set(storedDisabled);
      effectiveTools = new Set(platformToolsets.api_server);
    }
  });
  const service = createDeviceSettingsService({
    client,
    command,
    configRoot,
    environment: {
      HERMES_HOME: join(configRoot, "hermes"),
      NODE_ENV: "test",
      PYTHIA_WORKSPACE: options.workspaceRoot,
      PYTHIA_BASIC_MEMORY_MCP_URL: "http://127.0.0.1:4567/mcp",
      PYTHIA_HERMES_PROFILE: options.profile ?? "pythia-test",
      PYTHIA_STATE_ROOT: stateRoot,
    },
    readbackAttempts: 2,
    readbackDelayMs: 0,
    restartHermes: restart,
  });
  return {
    client,
    command,
    commandCalls,
    configRoot,
    platformToolsets,
    restart,
    service,
  };
}

describe("device settings", () => {
  it.each([
    {
      root: "/research/investor",
      cwd: "/research/investor/",
      status: "matched",
    },
    {
      root: "/research/investor",
      cwd: "/work/calculations",
      status: "different",
    },
    { root: "/research/investor", cwd: null, status: "unavailable" },
    {
      root: "/research/investor",
      cwd: "relative-folder",
      status: "unavailable",
    },
  ])(
    "reports configured Workspace/cwd $status without modifying either",
    async ({ root, cwd, status }) => {
      const { service, commandCalls, restart } = harness({
        workspaceRoot: root,
        nativeCwd: cwd,
        profile: "pythia-alt",
      });
      expect((await service.snapshot()).workspace).toEqual({
        root,
        native_cwd: cwd,
        status,
      });
      expect(commandCalls).toContainEqual([
        "-p",
        "pythia-alt",
        "config",
        "get",
        "terminal.cwd",
        "--json",
      ]);
      expect(commandCalls.some((args) => args.includes("set"))).toBe(false);
      expect(restart).not.toHaveBeenCalled();
    },
  );

  it("keeps the Workspace root visible when the native cwd read fails", async () => {
    const { service } = harness({
      workspaceRoot: "/research/nondefault",
      cwdUnavailable: true,
    });
    expect((await service.snapshot()).workspace).toEqual({
      root: "/research/nondefault",
      native_cwd: null,
      status: "unavailable",
    });
  });

  it("starts without optional secrets and reports independent native surfaces", async () => {
    const { commandCalls, service } = harness();
    const snapshot = await service.snapshot();
    expect(snapshot.model_auth).toEqual({
      provider: "openai-codex",
      status: "missing",
      setup_command: "just auth openai-codex",
    });
    expect(commandCalls).toContainEqual([
      "-p",
      "default",
      "auth",
      "status",
      "openai-codex",
    ]);
    expect(snapshot.skills).toContainEqual(
      expect.objectContaining({
        name: "research-notes",
        description: "Local override chosen by Hermes",
        kind: "other-hermes-skill",
        mutable: true,
        enabled: true,
      }),
    );
    expect(snapshot.skills).toContainEqual({
      name: "investment-memory",
      kind: "pythia-provided-name",
      mutable: true,
      enabled: false,
    });
    expect(snapshot.skills).toContainEqual(
      expect.objectContaining({
        name: "my-local-skill",
        kind: "other-hermes-skill",
      }),
    );
    expect(
      snapshot.toolsets.find((item) => item.name === "custom-prices"),
    ).toMatchObject({ enabled: false, configured: false });
  });

  it.each([
    // Pinned `hermes auth status` output (ADR 0020 capture).
    ["missing", capturedCli().auth_status_logged_out.stdout],
    ["present", "openai-codex: logged in\n"],
  ] as const)(
    "reports the root OpenAI Codex status without a global readiness claim (%s)",
    async (expected, authOutput) => {
      const { commandCalls, service } = harness({ authOutput });
      const snapshot = await service.snapshot();

      expect(snapshot.model_auth).toMatchObject({
        provider: "openai-codex",
        status: expected === "present" ? "configured" : "missing",
      });
      expect(commandCalls).toContainEqual([
        "-p",
        "default",
        "auth",
        "status",
        "openai-codex",
      ]);
      expect(snapshot).not.toHaveProperty("model_ready");
      expect(snapshot).not.toHaveProperty("provider_readiness");
    },
  );

  it("keeps another configured native provider independent from the Codex check", async () => {
    // Each provider status is shaped like the native auth command output. The
    // configured Anthropic fixture is intentionally never queried by Desk.
    const { commandCalls, service } = harness({
      authStatuses: {
        "openai-codex": "logged out",
        anthropic: "logged in",
      },
    });
    const snapshot = await service.snapshot();

    expect(snapshot.model_auth).toMatchObject({
      provider: "openai-codex",
      status: "missing",
      setup_command: "just auth openai-codex",
    });
    expect(commandCalls.filter((args) => args[2] === "auth")).toEqual([
      ["-p", "default", "auth", "status", "openai-codex"],
    ]);
    expect(commandCalls).not.toContainEqual(["auth", "status", "anthropic"]);
    expect(snapshot).not.toHaveProperty("model_ready");
  });

  it("uses one root-scoped native OAuth status for independent profiles without copies", async () => {
    const configRoot = temporaryRoot();
    const hermesRoot = join(configRoot, "hermes");
    const first = harness({ configRoot, profile: "pythia-first" });
    const second = harness({ configRoot, profile: "pythia-second" });
    mkdirSync(join(hermesRoot, "profiles", "pythia-first"), {
      recursive: true,
    });
    mkdirSync(join(hermesRoot, "profiles", "pythia-second"), {
      recursive: true,
    });

    await first.service.snapshot();
    await second.service.snapshot();

    expect(first.commandCalls).toContainEqual([
      "-p",
      "default",
      "auth",
      "status",
      "openai-codex",
    ]);
    expect(second.commandCalls).toContainEqual([
      "-p",
      "default",
      "auth",
      "status",
      "openai-codex",
    ]);
    expect(
      existsSync(join(hermesRoot, "profiles", "pythia-first", "auth.json")),
    ).toBe(false);
    expect(
      existsSync(join(hermesRoot, "profiles", "pythia-second", "auth.json")),
    ).toBe(false);
  });

  it("preserves existing provider and unknown fields in private store writes without exposing them", async () => {
    const { configRoot, commandCalls, service } = harness();
    const originalStores = {
      "secrets.json": {
        schema_version: 1,
        hermes_api_key: "PRIVATE_SERVER_BEARER",
        eodhd_api_token: "PRIVATE_SAVED_TOKEN",
        custom_provider: { token: "PRIVATE_CUSTOM_TOKEN" },
      },
      "settings.json": {
        schema_version: 1,
        sec_identity: "PRIVATE_INVESTOR investor@example.com",
        custom_provider: { region: "region-a" },
      },
    };
    for (const [name, original] of Object.entries(originalStores)) {
      const path = join(configRoot, name);
      writeFileSync(path, `${JSON.stringify(original)}\n`, { mode: 0o600 });
      atomicWriteStore(path, { ...requireStore(path), ui: { theme: "dark" } });
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
        ...original,
        ui: { theme: "dark" },
      });
      expect(statSync(path).mode & 0o077).toBe(0);
    }

    const snapshot = await service.snapshot();
    expect(snapshot).not.toHaveProperty("sec_identity");
    expect(snapshot).not.toHaveProperty("eodhd_credential");
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
    expect(commandCalls.flat().join(" ")).not.toContain("PRIVATE_");
  });

  it("passes only non-secret identity to the lifecycle restart command", () => {
    const environment = lifecycleCommandEnvironment({
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      XDG_RUNTIME_DIR: "/run/user/1000",
      API_SERVER_KEY: "PRIVATE_BEARER",
      EDGAR_IDENTITY: "PRIVATE_IDENTITY",
      EODHD_API_TOKEN: "PRIVATE_TOKEN",
      HERMES_HOME: "/private/config/hermes",
      NODE_ENV: "test",
      PATH: "/usr/bin",
      PYTHIA_INSTALL_CONFIG_HOME: "/private/config-base",
      PYTHIA_INSTALL_SYSTEMD_HOME: "/private/systemd",
      PYTHIA_DEV_LIFECYCLE_CLI: "/repo/scripts/dev/cli.mjs",
      PYTHIA_HERMES_PROFILE: "pythia-test",
      PYTHIA_LIFECYCLE_COMMAND: "/home/test/.local/bin/pythia",
      PYTHIA_STATE_ROOT: "/private/state",
    });
    expect(environment).toEqual({
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      XDG_RUNTIME_DIR: "/run/user/1000",
      HERMES_HOME: "/private/config/hermes",
      NODE_ENV: "test",
      PATH: "/usr/bin",
      PYTHIA_INSTALL_CONFIG_HOME: "/private/config-base",
      PYTHIA_INSTALL_SYSTEMD_HOME: "/private/systemd",
      PYTHIA_DEV_LIFECYCLE_CLI: "/repo/scripts/dev/cli.mjs",
      PYTHIA_HERMES_PROFILE: "pythia-test",
      PYTHIA_LIFECYCLE_COMMAND: "/home/test/.local/bin/pythia",
      PYTHIA_STATE_ROOT: "/private/state",
    });
    expect(JSON.stringify(environment)).not.toContain("PRIVATE_");
  });

  it("uses only the installed fixed Hermes restart command without secrets", async () => {
    const runner = vi.fn(async (..._arguments: unknown[]) => ({
      stdout: "ready",
      stderr: "",
    }));
    const restart = defaultRestart(
      {
        API_SERVER_KEY: "PRIVATE_BEARER",
        EODHD_API_TOKEN: "PRIVATE_TOKEN",
        HOME: "/home/test",
        NODE_ENV: "test",
        PATH: "/usr/bin",
        PYTHIA_LIFECYCLE_COMMAND: "/home/test/.local/bin/pythia",
      },
      runner as never,
    );
    await restart();
    expect(runner).toHaveBeenCalledTimes(1);
    const [command, args, options] = runner.mock.calls[0] ?? [];
    expect(command).toBe("/home/test/.local/bin/pythia");
    expect(args).toEqual(["restart-hermes"]);
    expect(JSON.stringify(options)).not.toContain("PRIVATE_");
  });

  it("refuses unsafe stores without overwriting them", () => {
    if (process.platform === "win32") return;
    const { configRoot } = harness();
    const path = join(configRoot, "secrets.json");
    writeFileSync(path, '{"eodhd_api_token":"EXISTING"}\n', { mode: 0o644 });
    expect(() => requireStore(path)).toThrowError(
      expect.objectContaining({
        code: "settings_store_invalid",
      }),
    );
    expect(readFileSync(path, "utf8")).toContain("EXISTING");
  });

  it("uses the exact global skill command and reports only after config and API readback", async () => {
    const { commandCalls, restart, service } = harness();
    await expect(
      service.setSkillEnabled("research-notes", false),
    ).resolves.toMatchObject({ name: "research-notes", enabled: false });
    expect(commandCalls).toContainEqual([
      "-p",
      "pythia-test",
      "config",
      "set",
      "skills.disabled",
      '["investment-memory","research-notes"]',
    ]);
    expect(restart).toHaveBeenCalledTimes(1);
    expect((await service.snapshot()).skills).toContainEqual(
      expect.objectContaining({ name: "research-notes", enabled: false }),
    );
  });

  it("does not offer mutation for Hermes's essential agent skill", async () => {
    const { command, restart, service } = harness();
    const before = command.mock.calls.length;
    await expect(
      service.setSkillEnabled("hermes-agent", false),
    ).rejects.toMatchObject({ code: "essential_skill" });
    expect(command.mock.calls.length).toBe(before);
    expect(restart).not.toHaveBeenCalled();
  });

  it("changes only the api_server toolset and preserves another platform", async () => {
    const { commandCalls, platformToolsets, service } = harness();
    const discordBefore = [...platformToolsets.discord].sort();
    await expect(
      service.setToolsetEnabled("custom-prices", true),
    ).resolves.toMatchObject({ name: "custom-prices", enabled: true });
    expect(commandCalls).toContainEqual([
      "-p",
      "pythia-test",
      "tools",
      "enable",
      "custom-prices",
      "--platform",
      "api_server",
    ]);
    expect([...platformToolsets.discord].sort()).toEqual(discordBefore);
  });

  it.each([
    ["skill", () => harness(), "unknown-skill"],
    ["toolset", () => harness(), "unknown-toolset"],
  ] as const)(
    "rejects an unknown %s before command or restart",
    async (kind, make, name) => {
      const { command, restart, service } = make();
      const before = command.mock.calls.length;
      const operation =
        kind === "skill"
          ? service.setSkillEnabled(name, false)
          : service.setToolsetEnabled(name, false);
      await expect(operation).rejects.toMatchObject({ status: 404 });
      expect(command.mock.calls.length).toBe(
        before + (kind === "skill" ? 1 : 0),
      );
      expect(restart).not.toHaveBeenCalled();
    },
  );

  it("fails closed on command failure and readback loss", async () => {
    const failed = harness({ commandFailure: true });
    await expect(
      failed.service.setSkillEnabled("research-notes", false),
    ).rejects.toMatchObject({ code: "hermes_command_failed" });
    expect(failed.restart).not.toHaveBeenCalled();

    const lost = harness({ readbackLoss: true });
    await expect(
      lost.service.setToolsetEnabled("custom-prices", true),
    ).rejects.toMatchObject({ code: "toolset_readback_failed" });
  });

  it("serializes concurrent native mutations through one external lock", async () => {
    let active = 0;
    let maximum = 0;
    const { service } = harness({
      restart: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 40));
        active -= 1;
      },
    });
    await Promise.all([
      service.setSkillEnabled("research-notes", false),
      service.setToolsetEnabled("custom-prices", true),
    ]);
    expect(maximum).toBe(1);
  });

  it("recovers a capability lock owned by an exited Desk process", async () => {
    const root = temporaryRoot();
    const lock = join(root, "capability-mutation.lock");
    writeFileSync(
      lock,
      `${JSON.stringify({ pid: 2_147_483_647, owner: "exited" })}\n`,
      { mode: 0o600 },
    );

    await expect(withFileLock(lock, async () => "recovered")).resolves.toBe(
      "recovered",
    );
    expect(existsSync(lock)).toBe(false);
  });

  it("retains settings and native choices across a service restart", async () => {
    const first = harness();
    const stored = {
      "settings.json":
        '{"schema_version":1,"sec_identity":"Saved Investor investor@example.com","custom_setting":true}\n',
      "secrets.json":
        '{"schema_version":1,"eodhd_api_token":"PERSISTED_TOKEN","custom_secret":"PRESERVED"}\n',
    };
    for (const [name, content] of Object.entries(stored))
      writeFileSync(join(first.configRoot, name), content, { mode: 0o600 });
    await first.service.setSkillEnabled("research-notes", false);
    const restarted = createDeviceSettingsService({
      client: first.client,
      command: first.command,
      configRoot: first.configRoot,
      environment: {
        HERMES_HOME: join(first.configRoot, "hermes"),
        NODE_ENV: "test",
        PYTHIA_HERMES_PROFILE: "pythia-test",
      },
      restartHermes: first.restart,
    });
    const snapshot = await restarted.snapshot();
    for (const [name, content] of Object.entries(stored))
      expect(readFileSync(join(first.configRoot, name), "utf8")).toBe(content);
    expect(snapshot.skills).toContainEqual(
      expect.objectContaining({ name: "research-notes", enabled: false }),
    );
  });
});
