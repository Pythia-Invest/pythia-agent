import { describe, expect, it, vi } from "vitest";
import { inheritProviderDefaults } from "../../scripts/dev/provider-defaults.mjs";
import { inheritModelDefaults } from "../../scripts/dev/runtime-config.mjs";

// Native providers mapping: hermes_cli/providers.py and runtime_provider.py.
function fixture(
  shared: Record<string, unknown>,
  local: Record<string, unknown> = {},
  model: Record<string, unknown> = {},
) {
  const state = { providers: structuredClone(local), model };
  const execute = vi.fn((_paths: unknown, args: string[]) => {
    const root = args[1] === "default";
    if (args[3] === "get") {
      if (args[4] === "providers")
        return JSON.stringify(root ? shared : state.providers);
      return JSON.stringify(
        root
          ? { provider: "custom:research", default: "synthetic-model" }
          : state.model,
      );
    }
    if (args[4] === "providers.research")
      state.providers.research = JSON.parse(args[5]);
    else if (args[4].startsWith("model."))
      state.model[args[4].slice(6)] = args[5];
    else throw Error("Unexpected mutation");
    return "saved";
  });
  return { state, execute, paths: { profile: "isolated" } };
}
const routing = {
  api: "http://127.0.0.1:12345/v1",
  transport: "codex_responses",
  key_env: "RESEARCH_API_KEY",
  default_model: "synthetic-model",
};

describe("shared native custom provider defaults", () => {
  it("inherits routing with model defaults without reading or checking credentials", () => {
    const f = fixture({ research: routing });
    expect(
      inheritModelDefaults(f.paths, "synthetic", { execute: f.execute }),
    ).toBe(true);
    expect(f.state.providers).toEqual({ research: routing });
    expect(f.state.model).toEqual({
      provider: "custom:research",
      default: "synthetic-model",
    });
    expect(f.execute.mock.calls.every(([, args]) => args[2] === "config")).toBe(
      true,
    );
  });
  it("repairs a missing selected route without changing an existing model", () => {
    const f = fixture(
      { research: routing },
      {},
      { provider: "custom:research", default: "other-model" },
    );
    expect(
      inheritModelDefaults(f.paths, "synthetic", { execute: f.execute }),
    ).toBe(false);
    expect(f.state.providers).toEqual({ research: routing });
    expect(f.state.model.default).toBe("other-model");
  });
  it.each([{ api: "http://localhost:9999/v1" }, { enabled: false }, {}])(
    "preserves every existing provider override, including partial ones",
    (override) => {
      const f = fixture({ research: routing }, { research: override });
      expect(
        inheritProviderDefaults(
          f.paths,
          "synthetic",
          "custom:research",
          f.execute,
        ),
      ).toBe(false);
      expect(f.state.providers.research).toEqual(override);
      expect(f.execute).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { ...routing, api_key: "never-copy" },
    { ...routing, extra_headers: { Authorization: "never-copy" } },
    { ...routing, key_cmd: "never-execute" },
    { ...routing, api: "https://user:password@example.test/v1" },
    { ...routing, api: "https://example.test/v1?token=never-copy" },
    { ...routing, api: "invalid" },
  ])(
    "leaves unsupported or secret-bearing configurations to native setup",
    (provider) => {
      const f = fixture({ research: provider });
      expect(
        inheritProviderDefaults(
          f.paths,
          "synthetic",
          "custom:research",
          f.execute,
        ),
      ).toBe(false);
      expect(f.state.providers).toEqual({});
      expect(f.execute.mock.calls.some(([, args]) => args[3] === "set")).toBe(
        false,
      );
    },
  );
  it.each(["api", "url", "base_url"])(
    "validates the %s endpoint even alongside another valid alias",
    (alias) => {
      const provider = {
        ...routing,
        url: routing.api,
        [alias]: "https://example.test/v1?token=synthetic",
      };
      const f = fixture({ research: provider });
      expect(
        inheritProviderDefaults(
          f.paths,
          "synthetic",
          "custom:research",
          f.execute,
        ),
      ).toBe(false);
      expect(f.execute.mock.calls.some(([, args]) => args[3] === "set")).toBe(
        false,
      );
    },
  );
  it.each(["api", "url", "base_url"])(
    "retains a validated %s native alias",
    (alias) => {
      const provider = { [alias]: routing.api, key_env: routing.key_env };
      const f = fixture({ research: provider });
      expect(
        inheritProviderDefaults(
          f.paths,
          "synthetic",
          "custom:research",
          f.execute,
        ),
      ).toBe(true);
      expect(f.state.providers.research).toEqual(provider);
    },
  );
  it("does not choose between conflicting endpoint aliases", () => {
    const f = fixture({
      research: { ...routing, base_url: "https://other.example.test/v1" },
    });
    expect(
      inheritProviderDefaults(
        f.paths,
        "synthetic",
        "custom:research",
        f.execute,
      ),
    ).toBe(false);
    expect(f.state.providers).toEqual({});
  });
  it("does not gate preparation on missing provider configuration", () => {
    const f = fixture({});
    expect(() =>
      inheritModelDefaults(f.paths, "synthetic", { execute: f.execute }),
    ).not.toThrow();
    expect(f.state.providers).toEqual({});
  });
  it("checks persistence without provider authentication or a network probe", () => {
    const f = fixture({ research: routing });
    const execute = vi.fn((_paths: unknown, args: string[]) =>
      JSON.stringify(args[1] === "default" ? { research: routing } : {}),
    );
    expect(() =>
      inheritProviderDefaults(f.paths, "synthetic", "custom:research", execute),
    ).toThrow("did not retain");
  });
});
