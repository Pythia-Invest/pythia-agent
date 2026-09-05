import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EODHDAuthError, EODHDRateLimitError, EODHDTimeoutError } from "eodhd";
import { describe, expect, it } from "vitest";
import { runEod } from "../managed/runner/eodhd.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("fixtures/eodhd-daily.json", import.meta.url)),
    "utf8",
  ),
);

describe("EODHD bounded runner", () => {
  it("uses only the qualified daily operation and caps output", async () => {
    let invocation: unknown[] = [];
    const response = await runEod(
      {
        api_token: "synthetic-token",
        ticker: "EXAMPLE.US",
        from: "2025-01-01",
        to: "2025-01-31",
        limit: 1,
      },
      () => ({
        eod: async (...args) => {
          invocation = args;
          return fixture;
        },
      }),
    );

    expect(invocation).toEqual([
      "EXAMPLE.US",
      { from: "2025-01-01", to: "2025-01-31", period: "d", order: "a" },
    ]);
    expect(response).toEqual({ status: "ok", data: [fixture[1]], error: null });
  });

  it.each([
    [
      new EODHDAuthError("do not expose provider body", 403),
      "invalid_configuration",
      "auth_error",
    ],
    [
      new EODHDRateLimitError("do not expose provider body", 17),
      "rate_limit",
      "rate_limit",
    ],
    [
      new EODHDTimeoutError("do not expose provider body"),
      "timeout",
      "timeout",
    ],
  ])(
    "preserves typed SDK failures without provider details",
    async (error, status, code) => {
      const response = await runEod(
        { api_token: "synthetic-token", ticker: "EXAMPLE.US" },
        () => ({
          eod: async () => {
            throw error;
          },
        }),
      );

      expect(response.status).toBe(status);
      expect(response.error?.code).toBe(code);
      expect(JSON.stringify(response)).not.toContain(
        "do not expose provider body",
      );
      expect(JSON.stringify(response)).not.toContain("synthetic-token");
    },
  );

  it("rejects bad input and missing configuration before client creation", async () => {
    let created = false;
    const missing = await runEod({ ticker: "EXAMPLE.US" }, () => {
      created = true;
      throw new Error("unreachable");
    });
    const invalid = await runEod(
      { api_token: "synthetic-token", ticker: "not a ticker!" },
      () => {
        created = true;
        throw new Error("unreachable");
      },
    );

    expect(missing.status).toBe("missing_configuration");
    expect(invalid.status).toBe("invalid");
    expect(created).toBe(false);
  });
});
