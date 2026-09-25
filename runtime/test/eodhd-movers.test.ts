import { expect, test, vi } from "vitest";
import { marketMovers } from "../managed/runner/eodhd-market-data-movers.js";
import { dashboard } from "../managed/runner/eodhd-market-data-dashboard.js";
import type { Client } from "../managed/runner/eodhd-market-data-operations.js";
// Synthetic response shaped by https://eodhd.com/financial-apis/stock-market-screener-api
const row = {
  code: "ONE",
  exchange: "US",
  currency_symbol: "$",
  name: "Synthetic One",
  last_day_data_date: "2026-01-02",
  adjusted_close: 10,
  refund_1d_p: 5,
  avgvol_1d: 200000,
  market_capitalization: 2e9,
};
test("screens preserve source ranking and differing session dates without inventing a common date", async () => {
  const screener = vi.fn(async (_params: unknown) => ({
    data: [row, { ...row, code: "TWO", last_day_data_date: "2025-12-31" }],
  }));
  const result = await marketMovers({ screener } as unknown as Client, {
    kind: "active",
    limit: 6,
  });
  expect(screener).toHaveBeenCalledOnce();
  expect(screener.mock.calls[0]?.[0]).toMatchObject({
    sort: "avgvol_1d.desc",
    limit: 6,
  });
  expect(result.data).toMatchObject({
    rows: [
      { symbol: "ONE.US", session: "2026-01-02" },
      { symbol: "TWO.US", session: "2025-12-31" },
    ],
  });
  expect(result.complete).toBe(false);
});
test("invalid rankings fail closed, while an empty successful screen remains empty", async () => {
  const screener = vi.fn(async () => ({ data: [] as object[] })),
    sdk = { screener } as unknown as Client;
  expect(
    (await marketMovers(sdk, { kind: "losers", limit: 6 })).data,
  ).toMatchObject({ rows: [] });
  for (const invalid of [
    { ...row, currency_symbol: "€" },
    { ...row, exchange: "LSE" },
    { ...row, refund_1d_p: Infinity },
    { ...row, last_day_data_date: "2026-02-30" },
  ]) {
    screener.mockResolvedValueOnce({ data: [invalid] });
    await expect(
      marketMovers(sdk, { kind: "active", limit: 6 }),
    ).rejects.toThrow();
  }
  screener.mockResolvedValueOnce({ data: [row, row] });
  await expect(marketMovers(sdk, { kind: "active", limit: 6 })).rejects.toThrow(
    "binding_mismatch",
  );
});
test("index references are admitted only to quotes, never reinterpreted as US chart symbols", async () => {
  const realTime = vi.fn(async () => ({
      code: "SYNTH.INDX",
      close: "NA",
      timestamp: "NA",
    })),
    sdk = { realTime } as unknown as Client;
  expect(
    (
      await dashboard(
        sdk,
        { kind: "quotes", symbols: ["SYNTH.INDX"] },
        "synthetic",
      )
    ).data,
  ).toMatchObject({ quotes: [{ symbol: "SYNTH.INDX", price: null }] });
  await expect(
    dashboard(sdk, { kind: "charts", symbols: ["SYNTH.INDX"] }, "synthetic"),
  ).rejects.toThrow("invalid_request");
});
