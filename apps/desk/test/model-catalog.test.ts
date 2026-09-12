import { describe, expect, it, vi } from "vitest";
import {
  modelCatalog,
  normalizeModelSelection,
  parseModelSelection,
} from "@/server/model-catalog";
import { createHermesClient } from "@/server/hermes";

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

  it("drops only effort overrides that contradict native model capabilities", () => {
    const catalog = modelCatalog(native);
    expect(
      normalizeModelSelection(catalog, {
        provider: "subscription",
        model: "model-a",
        effort: "none",
      }),
    ).toEqual({ provider: "subscription", model: "model-a" });
    expect(
      normalizeModelSelection(catalog, {
        provider: "subscription",
        model: "model-b",
        effort: "high",
      }),
    ).toEqual({ provider: "subscription", model: "model-b" });
    expect(
      normalizeModelSelection(catalog, {
        provider: "subscription",
        model: "model-a",
        effort: "ultra",
      }),
    ).toEqual({
      provider: "subscription",
      model: "model-a",
      effort: "ultra",
    });
  });

  it("removes the ordinary effort override from a stored MoA selection", () => {
    const catalog = modelCatalog({
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

    expect(
      normalizeModelSelection(catalog, {
        provider: "moa",
        model: "default",
        effort: "high",
      }),
    ).toEqual({ provider: "moa", model: "default" });
  });

  it("keeps the default implicit and forwards only bounded native run overrides", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/api/model/options")) return Response.json(native);
      return Response.json({ run_id: "fixture-run", status: "queued" });
    });
    const client = createHermesClient({
      baseUrl: "http://127.0.0.1:8645",
      apiKey: "synthetic-api-key-for-test",
      fetch: fetcher as typeof fetch,
    });
    expect(await client.modelOptions()).toEqual(modelCatalog(native));
    await client.startRun("fixture-session", "hello");
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      session_id: "fixture-session",
      input: "hello",
    });
    await client.startRun("fixture-session", "hello", {
      provider: "subscription",
      model: "model-a",
      effort: "medium",
    });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      session_id: "fixture-session",
      input: "hello",
      provider: "subscription",
      model: "model-a",
      model_options: { reasoning_effort: "medium" },
    });
    expect(parseModelSelection(undefined)).toBeUndefined();
  });
});
