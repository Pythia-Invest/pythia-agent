import { describe, expect, it } from "vitest";
import {
  modelCatalog,
  type ModelSelection,
  normalizeModelSelection,
  parseModelSelection,
} from "@/server/model-catalog";

const native = {
  provider: "subscription",
  model: "model-a",
  secret: "not-for-browser",
  providers: [
    {
      slug: "subscription",
      name: "Subscription",
      aliases: ["custom:subscription", null],
      authenticated: true,
      api_key: "not-for-browser",
      models: ["model-a", null, "model-b"],
      capabilities: {
        "model-a": { reasoning: true, can_disable_reasoning: false },
        "model-b": { reasoning: false },
      },
      featured_models: ["model-b"],
      pricing: {
        "model-a": { input: "$3.00", output: "$15.00", free: false },
        "model-b": { input: "free", output: "free", free: true },
      },
      source: "built-in",
      unavailable_models: ["model-b"],
    },
    {
      slug: "api-provider",
      name: "API account",
      authenticated: false,
      models: ["model-c"],
    },
  ],
};

describe("native model picker seam", () => {
  it("projects only public inventory fields and respects capabilities", () => {
    const catalog = modelCatalog(native);
    expect(JSON.stringify(catalog)).not.toContain("not-for-browser");
    expect(catalog.providers).toHaveLength(2);
    expect(catalog.providers[0]?.models).toEqual([
      {
        id: "model-a",
        reasoning: true,
        canDisableReasoning: false,
        price: { input: "$3.00", output: "$15.00", free: false },
        unavailable: false,
      },
      {
        id: "model-b",
        reasoning: false,
        canDisableReasoning: true,
        price: { input: "free", output: "free", free: true },
        unavailable: true,
      },
    ]);
    expect(catalog.providers[0]?.featuredModels).toEqual(["model-b"]);
    expect(catalog.providers[0]?.aliases).toEqual(["custom:subscription"]);
    expect(catalog.providers[1]?.authenticated).toBe(false);
    expect(modelCatalog(null).providers).toEqual([]);
  });

  it.each([
    null,
    {},
    { provider: "x", model: "" },
    { provider: "https://private", model: "m" },
    { provider: "x", model: "m", effort: "super" },
    { provider: "x", model: "m", api_key: "secret" },
    { provider: "x", model: "m\nsecret" },
  ])("rejects malformed or expansive selections: %j", (value) => {
    expect(() => parseModelSelection(value)).toThrow();
  });

  it("keeps an absent selection implicit", () => {
    expect(parseModelSelection(undefined)).toBeUndefined();
  });

  const moa = modelCatalog({
    provider: "moa",
    model: "default",
    providers: [
      {
        slug: "moa",
        name: "Mixture of Agents",
        authenticated: true,
        models: ["default"],
      },
    ],
  });
  // Drop an effort the model cannot honor (or MoA's ordinary one); keep the rest.
  it.each([
    ["subscription", "model-a", "none", false],
    ["subscription", "model-b", "high", false],
    ["subscription", "model-a", "ultra", true],
    ["moa", "default", "high", false],
  ])(
    "normalizes %s/%s effort %s against native capabilities (kept: %s)",
    (provider, model, effort, kept) => {
      const catalog = provider === "moa" ? moa : modelCatalog(native);
      expect(
        normalizeModelSelection(catalog, {
          provider,
          model,
          effort,
        } as ModelSelection),
      ).toEqual({ provider, model, ...(kept ? { effort } : {}) });
    },
  );
});
