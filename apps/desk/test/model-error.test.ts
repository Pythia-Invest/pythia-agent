import { describe, expect, it } from "vitest";
import { modelError } from "@/server/model-error";
import { createHermesClient, mapHermesEvent } from "@/server/hermes";

describe("native model errors", () => {
  // api_server run failure observed with the pinned Hermes release; auth wrapper
  // is not evidence that credentials themselves are missing.
  it.each([
    [
      "Provider authentication failed: No inference provider configured. Run 'hermes model'",
      "model_selection_missing",
    ],
    [
      "Provider authentication failed: No model credentials",
      "model_auth_missing",
    ],
    [
      "Provider authentication failed: private provider detail",
      "model_provider_failed",
    ],
  ])("propagates %s consistently", async (message, code) => {
    expect(modelError(message)?.code).toBe(code);
    expect(mapHermesEvent({ event: "run.failed", error: message })?.code).toBe(
      code,
    );
    const client = createHermesClient({
      baseUrl: "http://127.0.0.1:8645",
      apiKey: "synthetic-api-key",
      fetch: (async () =>
        Response.json({ error: { message } }, { status: 400 })) as typeof fetch,
    });
    await expect(
      client.startRun("fixture-session", "hello"),
    ).rejects.toMatchObject({ code });
    expect(modelError(message)?.error).not.toContain("private provider detail");
  });
  it("does not mistake unrelated provider failures for missing credentials", () => {
    expect(modelError("Rate limit exceeded")).toBeNull();
  });
});
