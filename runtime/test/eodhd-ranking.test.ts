// Invented records shaped by official bulk EOD and exchange-symbol docs.
import { afterEach, expect, test, vi } from "vitest";
import { EODHDClient } from "eodhd";
import { volumeRanking } from "../managed/runner/eodhd-market-data-ranking.js";
import { run } from "../managed/runner/eodhd-market-data.js";

const stock = (Code = "SYNTH", Type = "Common Stock") => ({
  Code,
  Name: "Synthetic security",
  Currency: "USD",
  Type,
});
const row = (code = "SYNTH", volume: unknown = 100, date = "2026-01-05") => ({
  code,
  exchange_short_name: "US",
  volume,
  date,
});
function sdk(catalogue: unknown[], snapshot: unknown[]) {
  return {
    exchanges: { symbols: vi.fn(async () => catalogue) },
    bulkEod: vi.fn(async () => snapshot),
  } as unknown as Pick<EODHDClient, "exchanges" | "bulkEod">;
}
afterEach(() => vi.unstubAllGlobals());
test("official SDK uses an explicit catalogue plus bulk snapshot; no screener or retries", async () => {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(new URL(url));
      return Response.json(
        String(url).includes("exchange-symbol-list") ? [stock()] : [row()],
      );
    }),
  );
  const client = new EODHDClient({
    apiToken: "synthetic",
    maxRetries: 0,
    logger: { debug() {}, warn() {}, error() {} },
  });
  const result = await volumeRanking(client, { exchange: "US", limit: 10 });
  expect(calls.map((url) => url.pathname)).toEqual([
    "/api/exchange-symbol-list/US",
    "/api/eod-bulk-last-day/US",
  ]);
  expect(calls[0]?.searchParams.get("delisted")).toBe("0");
  expect(result.data).toMatchObject({
    period: "completed_session",
    session_date: "2026-01-05",
    rows: [{ rank: 1, volume: "100", provider_ref: { native_id: "SYNTH.US" } }],
  });
});
test("ranks common stocks on one source date, excludes funds, stale and unknown volumes, preserves zero", async () => {
  const result = await volumeRanking(
    sdk(
      [
        stock(),
        stock("ZERO"),
        stock("STALE"),
        stock("MISSING"),
        stock("FUND", "ETF"),
      ],
      [
        row("ZERO", 0),
        row("STALE", 999, "2026-01-02"),
        row("FUND", 9999),
        row(),
        row("MISSING", null),
      ],
    ),
    { exchange: "US", limit: 10 },
  );
  expect(
    result.data.rows.map((row) => [row.symbol, row.volume, row.rank]),
  ).toEqual([
    ["SYNTH", "100", 1],
    ["ZERO", "0", 2],
  ]);
  expect(result.issues).toEqual(["ranking_coverage_limited"]);
  expect(result.data.coverage).toMatchObject({
    catalogue_common_stocks: 4,
    eligible_same_session: 2,
    omitted_common_stocks: 2,
  });
});
test("missing latest-session volumes cannot quietly select an older session", async () => {
  const result = await volumeRanking(
    sdk([stock(), stock("LATEST")], [row(), row("LATEST", null, "2026-01-06")]),
    { exchange: "US", limit: 10 },
  );
  expect(result.data.rows).toEqual([]);
  expect(result.data.session_date).toBe("2026-01-06");
  expect(result.issues).toContain("ranking_coverage_limited");
});
test("ties have a stable native-symbol order and invalid dates are excluded", async () => {
  const result = await volumeRanking(
    sdk(
      [stock("ZZ"), stock("AA"), stock("BAD")],
      [row("ZZ"), row("AA"), row("BAD", 200, "2026-02-30")],
    ),
    { exchange: "US", limit: 1 },
  );
  expect(result.data.rows.map((row) => row.symbol)).toEqual(["AA"]);
  expect(result.data.session_date).toBe("2026-01-05");
});
test("duplicate catalogue or snapshot codes and wrong exchange fail without guessing", async () => {
  for (const [catalogue, snapshot] of [
    [[stock(), stock()], [row()]],
    [[stock()], [row(), row()]],
    [[stock()], [{ ...row(), exchange_short_name: "LSE" }]],
  ])
    await expect(
      volumeRanking(sdk(catalogue ?? [], snapshot ?? []), {
        exchange: "US",
        limit: 10,
      }),
    ).rejects.toThrow();
});
test("endpoint rejection is an error without retry or fallback", async () => {
  const fetcher = vi.fn(
    async () => new Response("PRIVATE-ERROR-CANARY", { status: 403 }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await run({
    token: "synthetic",
    operation: "volume_ranking",
    arguments: { exchange: "US", limit: 10 },
  });
  expect(result).toMatchObject({ data: null, issues: ["access_denied"] });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

test("starts both independent inputs before waiting, then ranks only after both settle", async () => {
  let releaseCatalogue!: (rows: unknown[]) => void;
  let releaseSnapshot!: (rows: unknown[]) => void;
  const client = {
    exchanges: {
      symbols: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseCatalogue = resolve;
          }),
      ),
    },
    bulkEod: vi.fn(
      () =>
        new Promise((resolve) => {
          releaseSnapshot = resolve;
        }),
    ),
  };
  const result = volumeRanking(
    client as unknown as Pick<EODHDClient, "exchanges" | "bulkEod">,
    { exchange: "US", limit: 10 },
  );
  expect(client.exchanges.symbols).toHaveBeenCalledTimes(1);
  expect(client.bulkEod).toHaveBeenCalledTimes(1);
  releaseSnapshot([row()]);
  releaseCatalogue([stock()]);
  expect((await result).data.rows[0]?.volume).toBe("100");
});
