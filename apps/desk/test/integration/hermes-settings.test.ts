import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createHermesSettings } from "@/server/hermes-settings";
import { configPatch } from "@/server/hermes-settings-shape";

// Plugin and MCP switches take the device's capability lock in this state root.
const stateRoot = mkdtempSync(join(tmpdir(), "pythia-hermes-settings-"));
afterAll(() => rmSync(stateRoot, { recursive: true, force: true }));

/*
 * Synthetic settings-server replies, shaped after the pinned Hermes
 * web_server.py handlers: GET /api/config/schema {fields}, GET /api/config,
 * GET /api/env (EnvVarInfo with redacted_value), GET /api/providers/oauth
 * {providers[].status}, GET /api/dashboard/plugins/hub {plugins}.
 */
const replies: Record<string, unknown> = {
  "GET /api/config/schema": {
    fields: {
      timezone: {
        type: "select",
        options: ["UTC", "Europe/Brussels"],
        searchable: true,
      },
      fallback_providers: { type: "list" },
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
    fallback_providers: [
      {
        provider: "custom",
        model: "backup",
        base_url: "https://models.example/v1",
        api_key: "synthetic-fallback-key",
      },
    ],
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
  const restartHermes = vi.fn(async () => undefined);
  const service = createHermesSettings(
    {
      PYTHIA_HERMES_SETTINGS_URL: "http://127.0.0.1:43000",
      PYTHIA_HERMES_SETTINGS_TOKEN: "settings-bearer",
      PYTHIA_STATE_ROOT: stateRoot,
    } as unknown as NodeJS.ProcessEnv,
    fetcher,
    { restartHermes },
  );
  return { service, calls, restartHermes };
}

describe("Hermes settings through Desk", () => {
  it("shows only Settings fields, never credentials or Pythia's own config", async () => {
    const view = await hermes().service.config();
    expect(Object.keys(view.schema).sort()).toEqual([
      "approvals.mode",
      "auxiliary.vision.model",
      "fallback_providers",
      "timezone",
    ]);
    expect(view.values).toMatchObject({
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

  it("never shows an inline fallback key, and keeps it when the list is saved", async () => {
    const { service, calls } = hermes();
    const view = await service.config();
    expect(view.values.fallback_providers).toEqual([
      {
        provider: "custom",
        model: "backup",
        base_url: "https://models.example/v1",
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("synthetic-fallback-key");
    // Hermes replaces lists: the unchanged entry gets its key back, a new
    // one carries none.
    await service.saveConfig({
      values: {
        fallback_providers: [
          ...(view.values.fallback_providers as unknown[]),
          { provider: "openrouter", model: "second" },
        ],
      },
    });
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      config: {
        fallback_providers: [
          {
            provider: "custom",
            model: "backup",
            base_url: "https://models.example/v1",
            api_key: "synthetic-fallback-key",
          },
          { provider: "openrouter", model: "second" },
        ],
      },
    });
    // An edited entry is new: it does not inherit the old key.
    const { service: again, calls: later } = hermes();
    await again.saveConfig({
      values: {
        fallback_providers: [
          {
            provider: "custom",
            model: "backup",
            base_url: "https://elsewhere.example/v1",
          },
        ],
      },
    });
    expect(JSON.stringify(later)).not.toContain("synthetic-fallback-key");
  });

  it("writes a value only of its field's declared type and choices", async () => {
    const { service } = hermes();
    await expect(
      service.saveConfig({ values: { timezone: "Mars/Base" } }),
    ).rejects.toThrow(/isn't valid/);
    await expect(
      service.saveConfig({ values: { "approvals.mode": 5 } }),
    ).rejects.toThrow(/isn't valid/);
  });

  it("switches only a listed plugin or a path-safe MCP name, then restarts Hermes", async () => {
    const { service, restartHermes } = hermes();
    for (const name of ["pythia/", "pythia%2F", "..", ".", "a/b", "a\\b"]) {
      // Only listed plugins, by exact name; the name never becomes a path.
      await expect(service.setPluginEnabled(name, false)).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(service.setMcpEnabled(name, false)).rejects.toMatchObject({
        status: 400,
      });
    }
    await expect(
      service.setPluginEnabled("not-installed", true),
    ).rejects.toMatchObject({ status: 404 });
    expect(restartHermes).not.toHaveBeenCalled();
    await service.setPluginEnabled("kanban", true);
    await service.setMcpEnabled("x", false);
    expect(restartHermes).toHaveBeenCalledTimes(2);
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
