import { describe, expect, it } from "vitest";
import { formatBackendError } from "@/components/chat/backend-error";

describe("backend error formatting", () => {
  it.each([
    "Error code: 400 - {'error': {'type': 'server_error', 'message': 'Error from provider (Console): Upstream request failed: Model is unavailable.'}}",
    "HTTP 400: Error from provider (Console): Upstream request failed: Model is unavailable.",
  ])("unwraps a Hermes provider response without diagnosing it", (error) => {
    expect(formatBackendError(error)).toEqual({
      message: "Model is unavailable.",
      status: "400",
    });
  });

  it("keeps a plain Hermes message unchanged", () => {
    expect(formatBackendError("No Anthropic credentials found.")).toEqual({
      message: "No Anthropic credentials found.",
    });
  });
});
