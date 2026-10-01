import { expect, test, vi } from "vitest";
import { dashboard } from "../managed/runner/eodhd-market-data-dashboard.js";
import type { Client } from "../managed/runner/eodhd-market-data-operations.js";
test("quotes use one multi-symbol read and reject unexpected identities before presentation", async () => {
  const realTime = vi.fn(async () => [
    { code: "ONE.US", close: 10, timestamp: 1767366000 },
    { code: "TWO.US", close: 20, timestamp: 1767366000 },
  ]);
  const sdk = { realTime } as unknown as Client;
  await dashboard(
    sdk,
    { kind: "quotes", symbols: ["ONE.US", "TWO.US"] },
    "synthetic",
  );
  expect(realTime).toHaveBeenCalledExactlyOnceWith("ONE.US", { s: "TWO.US" });
  await expect(
    dashboard(
      sdk,
      { kind: "quotes", symbols: ["ONE.US", "ONE.US"] },
      "synthetic",
    ),
  ).rejects.toThrow();
  realTime.mockResolvedValueOnce([
    { code: "OTHER.US", close: 10, timestamp: 1767366000 },
  ]);
  await expect(
    dashboard(sdk, { kind: "quotes", symbols: ["ONE.US"] }, "synthetic"),
  ).rejects.toThrow("binding_mismatch");
});
test("charts isolate failures, bind symbols and preserve sparse closed bars without leaking tokens", async () => {
  const request = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.searchParams.get("symbol") === "TWO")
      throw Error("synthetic-secret");
    return Response.json([
      { s: "ONE", i: "1m", t: 1767366000000, c: 10 },
      { s: "ONE", i: "1m", t: 1767366120000, c: 11 },
    ]);
  }) as unknown as typeof fetch;
  const result = await dashboard(
    {} as Client,
    { kind: "charts", symbols: ["ONE.US", "TWO.US"] },
    "synthetic-secret",
    request,
  );
  expect(result.data).toMatchObject({
    charts: [
      {
        symbol: "ONE.US",
        source: {
          provider: "eodhd",
          feed: "cboe_edgx_history",
          interval: "1m",
          completion: "completed",
          session_timezone: "America/New_York",
        },
        points: [
          { t: 1767366000000, c: 10 },
          { t: 1767366120000, c: 11 },
        ],
        error: null,
      },
      { symbol: "TWO.US", points: [], failure: { code: "source_unavailable" } },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("synthetic-secret");
});
test("European index paths use bounded five-minute history and retain only the latest session", async () => {
  const intraday = vi.fn(async () => [
    { timestamp: 1767279600, close: 99 },
    { timestamp: 1767366000, close: 100 },
    { timestamp: 1767366100, close: null },
    { timestamp: 1767366300, close: 101 },
  ]);
  const sdk = { intraday } as unknown as Client;
  const result = await dashboard(
    sdk,
    { kind: "charts", symbols: ["STOXX50E.INDX"] },
    "synthetic",
  );
  expect(intraday).toHaveBeenCalledWith(
    "STOXX50E.INDX",
    expect.objectContaining({ interval: "5m" }),
  );
  expect(result.data).toMatchObject({
    charts: [
      {
        symbol: "STOXX50E.INDX",
        source: {
          provider: "eodhd",
          feed: "intraday",
          interval: "5m",
          completion: "unknown",
          session_timezone: "Europe/Paris",
        },
        session: "2026-01-02",
        points: [
          { t: 1767366000000, c: 100 },
          { t: 1767366300000, c: 101 },
        ],
        error: null,
      },
    ],
  });
  intraday.mockResolvedValueOnce([
    { timestamp: 1767366000, close: 100 },
    { timestamp: 1767366000, close: 101 },
  ]);
  expect(
    (
      await dashboard(
        sdk,
        { kind: "charts", symbols: ["STOXX50E.INDX"] },
        "synthetic",
      )
    ).data,
  ).toMatchObject({
    charts: [{ points: [], failure: { code: "invalid_response" } }],
  });
});
