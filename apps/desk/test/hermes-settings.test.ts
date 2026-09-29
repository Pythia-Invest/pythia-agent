import { describe, expect, it } from "vitest";
import { createHermesSettings } from "@/server/hermes-settings";
import { configPatch } from "@/server/hermes-settings-shape";
import { isEditableHermesKey } from "@/settings/hermes-pages";

/*
 * Synthetic settings-server replies, shaped after the pinned Hermes
 * web_server.py handlers: GET /api/config/schema {fields}, GET /api/config,
 * GET /api/env (EnvVarInfo with redacted_value), GET /api/providers/oauth
 * {providers[].status}, GET /api/dashboard/plugins/hub {plugins}.
 */
const replies: Record<string, unknown> = {
  "GET /api/config/schema": {
    fields: {
      timezone: { type: "select", options: ["UTC"], searchable: true },
      "approvals.mode": { type: "string", description: "Approval mode" },
      "auxiliary.vision.model": { type: "string" },
      "auxiliary.vision.api_key": { type: "string" },
      "terminal.cwd": { type: "string" },
      "logging.level": { type: "string" },
    },
  },
  "GET /api/config": {
    timezone: "UTC",
    approvals: { mode: "manual" },
    auxiliary: { vision: { model: "m", api_key: "synthetic-key-0000" } },
    terminal: { cwd: "/synthetic/workspace" },
    model: { provider: "openrouter", default: "synthetic/model" },
    mcp_servers: { x: { env: { TOKEN: "synthetic-mcp-token" } } },
  },
  "GET /api/env": {
    OPENROUTER_API_KEY: {
      category: "provider",
      provider_label: "OpenRouter",
      description: "OpenRouter API key",
      url: "https://openrouter.ai/keys",
      is_set: true,
      is_password: true,
      redacted_value: "sk-o...9a7c",
    },
    TELEGRAM_BOT_TOKEN: {
      category: "messaging",
      is_set: true,
      is_password: true,
      redacted_value: "1234...abcd",
    },
  },
  "GET /api/providers/oauth": {
    providers: [
      {
        id: "claude-code",
        name: "Claude Code",
        flow: "external",
        cli_command: "claude setup-token",
        disconnectable: false,
        status: {
          logged_in: true,
          source_label: "~/.claude/.credentials.json",
          token_preview: "…kj1wAA",
        },
      },
      {
        id: "nous",
        name: "Nous Portal",
        flow: "device_code",
        docs_url: "https://portal.nousresearch.com",
        disconnectable: true,
        status: { logged_in: false, source_label: "Nous Portal" },
      },
    ],
  },
  "GET /api/dashboard/plugins/hub": {
    plugins: [
      {
        name: "pythia",
        source: "user",
        runtime_status: "enabled",
        path: "/synthetic/plugins/pythia",
      },
      { name: "kanban", source: "bundled", runtime_status: "inactive" },
    ],
  },
};

function hermes() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetcher = (async (url: URL, init: RequestInit) => {
    const method = init.method ?? "GET";
    const path = url.pathname;
    calls.push({
      method,
      path,
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer settings-bearer",
    );
    const reply = replies[`${method} ${path}`] ?? { ok: true };
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  const service = createHermesSettings(
    {
      PYTHIA_HERMES_SETTINGS_URL: "http://127.0.0.1:43000",
      PYTHIA_HERMES_SETTINGS_TOKEN: "settings-bearer",
    } as unknown as NodeJS.ProcessEnv,
    fetcher,
  );
  return { service, calls };
}

describe("Hermes settings through Desk", () => {
  it("shows only Settings fields, never credentials or Pythia's own config", async () => {
    const view = await hermes().service.config();
    expect(Object.keys(view.schema).sort()).toEqual([
      "approvals.mode",
      "auxiliary.vision.model",
      "timezone",
    ]);
    expect(view.values).toEqual({
      timezone: "UTC",
      "approvals.mode": "manual",
      "auxiliary.vision.model": "m",
    });
    expect(view.model).toEqual({
      provider: "openrouter",
      model: "synthetic/model",
    });
    const text = JSON.stringify(view);
    for (const secret of ["synthetic-key", "synthetic-mcp", "/synthetic"])
      expect(text).not.toContain(secret);
  });

  it("writes only fields a page shows, as Hermes's nested partial config", async () => {
    const { service, calls } = hermes();
    await service.saveConfig({
      values: { "approvals.mode": "smart", timezone: "Europe/Brussels" },
    });
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      config: { approvals: { mode: "smart" }, timezone: "Europe/Brussels" },
    });
    for (const key of [
      "terminal.cwd",
      "toolsets",
      "plugins.enabled",
      "mcp_servers.x",
      "model.default",
      "auxiliary.vision.api_key",
      "updates.non_interactive_local_changes",
      "logging.level",
    ]) {
      expect(isEditableHermesKey(key)).toBe(false);
      expect(() => configPatch({ values: { [key]: "x" } })).toThrow();
    }
    expect(() =>
      configPatch({ values: { command_allowlist: [{ api_key: "x" }] } }),
    ).toThrow();
  });

  it("reports provider keys as set with their last four characters only", async () => {
    const { accounts, keys } = await hermes().service.providers();
    expect(keys).toEqual([
      {
        key: "OPENROUTER_API_KEY",
        label: "OpenRouter API key",
        provider: "OpenRouter",
        docsUrl: "https://openrouter.ai/keys",
        advanced: false,
        set: true,
        secret: true,
        hint: "9a7c",
      },
    ]);
    // A local file path is not shown as a sign-in's source, nor any token.
    expect(accounts[0]).toEqual({
      id: "claude-code",
      name: "Claude Code",
      flow: "external",
      command: "claude setup-token",
      connected: true,
      disconnectable: false,
    });
    expect(JSON.stringify(accounts)).not.toContain("kj1wAA");
  });

  it("sets and clears only keys Hermes lists as provider keys", async () => {
    const { service, calls } = hermes();
    await service.setKey({ key: "OPENROUTER_API_KEY", value: " sk-new " });
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      key: "OPENROUTER_API_KEY",
      value: "sk-new",
    });
    await service.setKey({ key: "OPENROUTER_API_KEY", value: null });
    expect(calls.find((call) => call.method === "DELETE")?.body).toEqual({
      key: "OPENROUTER_API_KEY",
    });
    await expect(
      service.setKey({ key: "TELEGRAM_BOT_TOKEN", value: "x" }),
    ).rejects.toThrow();
    await expect(
      service.setKey({ key: "OPENROUTER_API_KEY", value: "a\nb" }),
    ).rejects.toThrow();
  });

  it("keeps Pythia's own plugin on and hides plugin paths", async () => {
    const { service, calls } = hermes();
    const plugins = await service.plugins();
    expect(plugins.map((plugin) => [plugin.name, plugin.active])).toEqual([
      ["pythia", true],
      ["kanban", false],
    ]);
    expect(plugins[0]?.locked).toBeTruthy();
    expect(JSON.stringify(plugins)).not.toContain("/synthetic");
    await expect(service.setPluginEnabled("pythia", false)).rejects.toThrow();
    await service.setPluginEnabled("kanban", true);
    expect(calls.at(-2)?.path).toBe(
      "/api/dashboard/agent-plugins/kanban/enable",
    );
  });

  it("signs in only providers with an in-app flow", async () => {
    await expect(hermes().service.startSignIn("claude-code")).rejects.toThrow(
      /command/,
    );
  });

  it("refuses a settings service that isn't on this device", async () => {
    const service = createHermesSettings(
      {
        PYTHIA_HERMES_SETTINGS_URL: "http://example.com:43000",
        PYTHIA_HERMES_SETTINGS_TOKEN: "settings-bearer",
      } as unknown as NodeJS.ProcessEnv,
      (() => {
        throw new Error("never called");
      }) as typeof fetch,
    );
    await expect(service.config()).rejects.toThrow(/this device/);
    await expect(
      createHermesSettings({} as NodeJS.ProcessEnv).config(),
    ).rejects.toMatchObject({
      status: 503,
    });
  });
});
