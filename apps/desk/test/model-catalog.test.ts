import { describe, expect, it, vi } from "vitest";
import { modelCatalog, parseModelSelection } from "@/server/model-catalog";
import { createHermesClient } from "@/server/hermes";

const native = {
  provider: "subscription",
  model: "model-a",
  secret: "not-for-browser",
  providers: [
    {
      slug: "subscription",
      name: "Subscription",
      authenticated: true,
      api_key: "not-for-browser",
      models: ["model-a", null, "model-b"],
      capabilities: {
        "model-a": { reasoning: true, can_disable_reasoning: false },
        "model-b": { reasoning: false },
      },
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
      { id: "model-a", reasoning: true, canDisableReasoning: false },
      { id: "model-b", reasoning: false, canDisableReasoning: true },
    ]);
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
