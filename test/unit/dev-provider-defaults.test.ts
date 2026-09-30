import { describe, expect, it, vi } from "vitest";
import { inheritModelDefaults } from "../../scripts/dev/runtime-config.mjs";

// Shapes and aliases from the pinned Hermes config.py/providers.py. This fixture
// models config command storage; real native CLI readback is checked separately.
function fixture(
  shared: Record<string, unknown>,
  local: Record<string, unknown> = { model: "" },
) {
  const profiles: Record<string, Record<string, unknown>> = {
    default: shared,
    test: local,
  };
  const execute = vi.fn(
    (
      _paths: unknown,
      args: [string, string, string, string, string, string?],
    ) => {
      const config = profiles[args[1]];
      const parts = args[4]
        .split(/(?<!\\)\./u)
        .map((part) => part.replaceAll("\\.", "."));
      let parent: Record<string, unknown> | undefined = config;
      for (const part of parts.slice(0, -1)) {
        if (
          args[3] === "set" &&
          parent &&
          (!parent[part] || typeof parent[part] !== "object")
        )
          parent[part] = {};
        parent = parent?.[part] as Record<string, unknown> | undefined;
      }
      const key = parts[parts.length - 1] as string;
      if (args[3] === "set") {
        if (!parent) throw new Error("Missing fixture parent");
        parent[key] = args[4].startsWith("model.")
          ? args[5]
          : JSON.parse(args[5] ?? "");
        return "saved";
      }
      if (parent?.[key] === undefined)
        throw new Error(`Config key not set: ${args[4]}`);
      return JSON.stringify(parent[key]);
    },
  );
  const run = () =>
    inheritModelDefaults({ profile: "test" }, "fixture-bearer", { execute });
  return { run, execute, local };
}

describe("shared custom provider inheritance", () => {
  it.each(["custom:research.proxy", "research.proxy", "Research Proxy"])(
    "inherits only the selected keyed provider (%s) before its model",
    (provider) => {
      const definition = {
        name: "Research Proxy",
        api: "http://127.0.0.1:8123/v1",
        transport: "responses",
        key_env: "RESEARCH_PROXY_KEY",
        default_model: "research-model",
        models: {
          "research-model": { context_length: 128000, reasoning: true },
        },
      };
      const f = fixture({
        model: { provider, default: "research-model" },
        providers: {
          "research.proxy": definition,
          other: { api_key: "unrelated-secret" },
        },
      });
      expect(f.run()).toBe(true);
      expect(f.local.providers).toEqual({ "research.proxy": definition });
      expect(f.local.model).toEqual({ provider, default: "research-model" });
      const writes = f.execute.mock.calls
        .map(([, args]) => args)
        .filter((args) => args[3] === "set");
      expect(writes[0]?.[4]).toBe("providers.research\\.proxy");
      expect(JSON.stringify(writes)).not.toContain("unrelated-secret");
      f.execute.mockClear();
      expect(f.run()).toBe(false);
      expect(f.execute).toHaveBeenCalledTimes(1);
    },
  );

  it("inherits a legacy definition in native keyed form without transporting other profile credentials", () => {
    const existing = {
      name: "Local",
      base_url: "http://127.0.0.1:8124/v1",
      api_key: "local-secret",
    };
    const selected = {
      name: "Lab Proxy",
      base_url: "https://models.example/v1",
      api_mode: "chat_completions",
      models: ["small", { id: "large", context_length: 64000 }],
    };
    const f = fixture(
      {
        model: { provider: "custom:lab-proxy", default: "large" },
        custom_providers: [selected],
      },
      { model: "", custom_providers: [existing] },
    );
    expect(f.run()).toBe(true);
    expect(f.local.custom_providers).toEqual([existing]);
    // Hermes's own keyed translation of a legacy row.
    expect(f.local.providers).toEqual({
      "lab-proxy": {
        name: "Lab Proxy",
        api: "https://models.example/v1",
        transport: "chat_completions",
        models: ["small", { id: "large", context_length: 64000 }],
      },
    });
    const writes = f.execute.mock.calls
      .map(([, args]) => args)
      .filter((args) => args[3] === "set");
    expect(writes[0]?.[4]).toBe("providers.lab-proxy");
    expect(JSON.stringify(writes)).not.toContain("local-secret");
  });

  it("inherits a legacy provider without requiring a local legacy list", () => {
    const selected = {
      name: "Lab",
      base_url: "https://models.example/v1",
      model: "small",
    };
    const f = fixture({
      model: { provider: "custom:lab", default: "small" },
      custom_providers: [selected],
    });
    expect(f.run()).toBe(true);
    expect(f.local.providers).toEqual({
      lab: {
        name: "Lab",
        api: "https://models.example/v1",
        default_model: "small",
      },
    });
  });

  it.each([
    { request_timeout_seconds: 600 },
    { models: { "gpt-large": { timeout_seconds: 900 } } },
    { api_key: "built-in-secret" },
  ])(
    "leaves settings for a built-in provider alone and inherits only its model (%j)",
    (settings) => {
      const f = fixture({
        model: { provider: "openrouter", default: "gpt-large" },
        providers: { openrouter: settings },
      });
      expect(f.run()).toBe(true);
      expect(f.local.providers).toBeUndefined();
      expect(f.local.model).toEqual({
        provider: "openrouter",
        default: "gpt-large",
      });
      expect(JSON.stringify(f.execute.mock.calls)).not.toContain(
        "built-in-secret",
      );
    },
  );

  it("ignores a disabled definition, as Hermes's resolver does", () => {
    const f = fixture({
      model: { provider: "custom:lab", default: "small" },
      providers: {
        lab: { api: "https://old.example/v1", enabled: false },
      },
      custom_providers: [
        { name: "Lab", base_url: "https://models.example/v1" },
      ],
    });
    expect(f.run()).toBe(true);
    expect(f.local.providers).toEqual({
      lab: { name: "Lab", api: "https://models.example/v1" },
    });
  });

  it("keeps the target profile's own definition even when the root has none", () => {
    const own = { api: "https://own.example/v1" };
    const f = fixture(
      { model: { provider: "custom:lab", default: "small" } },
      { model: "", providers: { lab: own } },
    );
    expect(f.run()).toBe(true);
    expect(f.local.providers).toEqual({ lab: own });
  });

  it("preserves an existing provider definition and unrelated profile configuration", () => {
    const custom = { api: "http://127.0.0.1:9001/v1", transport: "responses" };
    const f = fixture(
      {
        model: { provider: "custom:lab", default: "small" },
        providers: { lab: { api: "https://models.example/v1" } },
      },
      {
        model: "",
        providers: { lab: custom },
        terminal: { cwd: "/user/work" },
      },
    );
    expect(f.run()).toBe(true);
    expect(f.local.providers).toEqual({ lab: custom });
    expect(f.local.terminal).toEqual({ cwd: "/user/work" });
  });

  it.each([
    { api_key: "do-not-copy" },
    { apiKey: "do-not-copy" },
    { extra_headers: { Authorization: "do-not-copy" } },
    { key_cmd: "credential-command" },
    { extra_body: { token: "do-not-copy" } },
    { models: { small: { api_key: "do-not-copy" } } },
    { api: "https://user:do-not-copy@models.example/v1" },
    { api: "https://models.example/v1?token=do-not-copy" },
    { key_env: "bad-reference=do-not-copy" },
  ])("rejects unsafe provider fields before any native write", (fields) => {
    const f = fixture({
      model: { provider: "custom:lab", default: "small" },
      providers: { lab: { api: "https://models.example/v1", ...fields } },
    });
    let message = "";
    try {
      f.run();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("do-not-copy");
    expect(f.execute.mock.calls.some(([, args]) => args[3] === "set")).toBe(
      false,
    );
  });

  it("does not seed a model whose named provider is missing", () => {
    const f = fixture({
      model: { provider: "custom:missing", default: "small" },
    });
    expect(f.run).toThrow("definition is missing");
    expect(f.local.model).toBe("");
  });

  it("rejects an ambiguous alias before changing the profile", () => {
    const f = fixture({
      model: { provider: "custom:lab", default: "small" },
      providers: {
        first: { name: "Lab", api: "https://first.example/v1" },
        second: { name: "Lab", api: "https://second.example/v1" },
      },
    });
    expect(f.run).toThrow("ambiguous");
    expect(f.execute.mock.calls.some(([, args]) => args[3] === "set")).toBe(
      false,
    );
  });

  it("preserves malformed local provider data instead of replacing it", () => {
    const f = fixture(
      {
        model: { provider: "custom:lab", default: "small" },
        providers: { lab: { api: "https://models.example/v1" } },
      },
      { model: "", providers: { lab: "user-owned" } },
    );
    expect(f.run).toThrow("already configured");
    expect(f.local.providers).toEqual({ lab: "user-owned" });
    expect(f.local.model).toBe("");
  });

  it("requires provider readback before writing the model, and retries an interrupted provider-only write", () => {
    const f = fixture({
      model: { provider: "custom:lab", default: "small" },
      providers: { lab: { api: "https://models.example/v1" } },
    });
    const original = f.execute.getMockImplementation();
    if (!original) throw new Error("Missing fixture command");
    f.execute.mockImplementation((paths, args) =>
      args[1] === "test" && args[3] === "get" && args[4] === "providers.lab"
        ? "{}"
        : original(paths, args),
    );
    expect(f.run).toThrow("did not retain the shared custom provider");
    expect(f.local.model).toBe("");
    f.execute.mockImplementation(original);
    expect(f.run()).toBe(true);
  });

  it.each([{ provider: "custom:owned" }, "my-model"])(
    "preserves an existing model choice (%j) without reading shared settings",
    (model) => {
      const f = fixture({}, { model });
      expect(f.run()).toBe(false);
      expect(f.execute).toHaveBeenCalledTimes(1);
    },
  );

  it("inherits only native model selection fields, never a shared model credential", () => {
    const f = fixture({
      model: {
        provider: "openai-codex",
        default: "fixture-model",
        api_key: "must-not-copy",
      },
    });
    expect(f.run()).toBe(true);
    expect(f.local.model).toEqual({
      provider: "openai-codex",
      default: "fixture-model",
    });
    expect(JSON.stringify(f.execute.mock.calls)).not.toContain("must-not-copy");
  });

  it("leaves an unconfigured profile alone when the root has no model", () => {
    const f = fixture({ model: "" });
    expect(f.run()).toBe(false);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.local.model).toBe("");
  });

  it.each([
    "https://user:secret@models.example/v1",
    "https://models.example/v1?key=secret",
    "https://models.example/v1#secret",
  ])(
    "rejects a credential-bearing shared model endpoint before writing: %s",
    (base_url) => {
      const f = fixture({
        model: { provider: "openrouter", default: "small", base_url },
      });
      expect(f.run).toThrow("Shared model endpoint must not contain");
      expect(f.execute.mock.calls.some(([, args]) => args[3] === "set")).toBe(
        false,
      );
    },
  );

  it("requires native readback of the written model", () => {
    const f = fixture({ model: { provider: "openrouter", default: "small" } });
    const original = f.execute.getMockImplementation();
    if (!original) throw new Error("Missing fixture command");
    // Hermes acknowledges the write but does not keep it.
    f.execute.mockImplementation((paths, args) =>
      args[1] === "test" && args[3] === "set" ? "saved" : original(paths, args),
    );
    expect(f.run).toThrow("Hermes did not retain the shared model selection");
  });
});
