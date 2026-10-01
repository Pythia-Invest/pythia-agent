// Synthetic fixtures shaped by official EODHD endpoint docs and SDK1.1.0.
import { expect, test } from "vitest";
import { EODHDAuthError, EODHDRateLimitError } from "eodhd";
import {
  execute,
  type Client,
} from "../managed/runner/eodhd-market-data-operations.js";
import { run } from "../managed/runner/eodhd-market-data.js";
import { decimal } from "../managed/runner/eodhd-market-data-values.js";
const isin = "US0378331005";
test("exact symbol identifiers preserve raw grain and reject other references", async () => {
  for (const returned of ["SYNTH.US", "OTHER.US"]) {
    const result = await execute(
      fake({
        idMapping: async (params) => {
          expect(params?.["filter[symbol]"]).toBe("SYNTH.US");
          return {
            meta: { total: 1, limit: 100, offset: 0 },
            data: [{ symbol: returned, isin, figi: "BBG000B9XRY4" }],
            links: { next: null },
          } as never;
        },
      }),
      "identifiers",
      { symbol: "SYNTH.US" },
    );
    expect(result.complete).toBe(returned === "SYNTH.US");
    if (returned === "SYNTH.US")
      expect(result.data).toEqual([
        expect.objectContaining({
          symbol: returned,
          isin,
          figi: "BBG000B9XRY4",
        }),
      ]);
    else expect(result.issues).toContain("identifier_conflict");
  }
});
const fake = (methods: Partial<Client>) => methods as Client;
test("exact details preserve non-stock catalogue results without broadening identity", async () => {
  // Official Search API filtered to one exchange: type=all; returned Type describes the product.
  // https://eodhd.com/financial-apis/search-api-for-stocks-etfs-mutual-funds
  const requests: unknown[] = [];
  const sdk = fake({
    search: async (query, params) => {
      requests.push({ query, params });
      return [
        {
          Code: "SYNTH",
          Exchange: "US",
          Name: "Synthetic Fund",
          Type: "ETF",
          Currency: "USD",
        },
        {
          Code: "SYNTH",
          Exchange: "LSE",
          Name: "Synthetic Fund",
          Type: "ETF",
          Currency: "GBP",
        },
      ] as never;
    },
  });
  const details = await execute(sdk, "details", { symbol: "SYNTH.US" });
  expect(details.data).toEqual([
    expect.objectContaining({ symbol: "SYNTH.US", type: "ETF" }),
  ]);
  expect(requests).toEqual([
    { query: "SYNTH", params: { exchange: "US", limit: 100, type: "all" } },
  ]);
  await expect(execute(sdk, "search", { query: "SYNTH" })).rejects.toThrow(
    "invalid_request",
  );
});
test("wire decimal conversion preserves finite JS value, omits sentinels and missing", () => {
  expect(decimal(1e-7)).toBe("0.0000001");
  expect(decimal(1e21)).toBe("1000000000000000000000");
  expect(decimal(0)).toBe("0");
  for (const invalid of [null, undefined, NaN, Infinity, -1, "1"])
    expect(decimal(invalid)).toBeNull();
});
test("reverse retains distinct assertions per symbol, coalesces exact records and exhausts by row offset", async () => {
  const calls: number[] = [];
  const sdk = fake({
    idMapping: async (params) => {
      const offset = params?.["page[offset]"] ?? 0;
      calls.push(offset);
      const data =
        offset === 0
          ? Array.from({ length: 100 }, (_, i) => ({
              symbol: "SYNTH.US",
              isin,
              figi: i % 2 ? "one" : "two",
            }))
          : [{ symbol: "SYNTH.US", isin, figi: "three" }];
      return {
        meta: { total: 101, limit: 100, offset },
        data,
        links: { next: offset === 0 ? "unused" : null },
      } as never;
    },
  });
  const result = await execute(sdk, "reverse", { isin });
  expect(result.complete).toBe(true);
  expect(result.data).toHaveLength(3);
  expect(calls).toEqual([0, 100]);
});
test("reverse repeated whole page and total drift remain partial", async () => {
  for (const changed of [false, true]) {
    const result = await execute(
      fake({
        idMapping: async (params) =>
          ({
            meta: {
              total: changed && params?.["page[offset]"] ? 301 : 300,
              limit: 100,
              offset: params?.["page[offset]"],
            },
            data: Array.from({ length: 100 }, () => ({
              symbol: "SYNTH.US",
              isin,
            })),
            links: { next: "unused" },
          }) as never,
      }),
      "reverse",
      { isin },
    );
    expect(result.complete).toBe(false);
    expect(result.issues).toContain(
      changed ? "pagination_changed" : "pagination_repeated",
    );
  }
});
test("exact catalogue details retain conflicting returned ISINs and supported type only as metadata", async () => {
  const result = await execute(
    fake({
      search: async () =>
        [
          {
            Code: "SYNTH",
            Exchange: "US",
            Name: "Synthetic",
            Type: "Common Stock",
            Currency: "USD",
            ISIN: isin,
          },
          {
            Code: "OTHER",
            Exchange: "US",
            Name: "Other",
            Type: "Common Stock",
            Currency: "USD",
            ISIN: isin,
          },
        ] as never,
    }),
    "details",
    { symbol: "SYNTH.US" },
  );
  expect(result.data).toHaveLength(1);
});
test("bounded dates rejected before SDK and valid quote survives missing timestamp", async () => {
  let calls = 0;
  const sdk = fake({
    eod: async () => {
      calls++;
      return [];
    },
    realTime: async () =>
      ({ code: "SYNTH.US", close: 3, volume: null }) as never,
  });
  await expect(
    execute(sdk, "eod", {
      symbol: "SYNTH.US",
      from: "2020-02-31",
      to: "2021-01-01",
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  const result = await execute(sdk, "latest", { symbol: "SYNTH.US" });
  expect(result.data).toMatchObject([
    { close: "3", timestamp: null, volume: null },
  ]);
});
test.each([401, 403])(
  "worker preserves status%s without provider body",
  async (status) => {
    const result = await run(
      {
        token: "synthetic",
        operation: "details",
        arguments: { symbol: "X.US" },
      },
      () =>
        fake({
          search: async () => {
            throw new EODHDAuthError("private-canary", status);
          },
        }),
    );
    expect(result).toMatchObject({
      http_status: status,
      issues: [status === 401 ? "authentication_failed" : "access_denied"],
    });
    expect(JSON.stringify(result)).not.toContain("private-canary");
  },
);
test("worker preserves finite retryAfter and hides Infinity", async () => {
  for (const value of [4, Infinity]) {
    const result = await run(
      {
        token: "synthetic",
        operation: "details",
        arguments: { symbol: "X.US" },
      },
      () =>
        fake({
          search: async () => {
            throw new EODHDRateLimitError("private-canary", value);
          },
        }),
    );
    expect(result).toMatchObject({
      issues: ["rate_limit"],
      retry_after: Number.isFinite(value) ? value : null,
    });
  }
});
test("later mapping403 retains earlier records and exact access diagnostic", async () => {
  let count = 0;
  const result = await execute(
    fake({
      idMapping: async () => {
        if (count++) throw new EODHDAuthError("private-canary", 403);
        return {
          meta: { total: 101, limit: 100, offset: 0 },
          data: Array.from({ length: 100 }, (_, i) => ({
            symbol: `SYNTH${i}.US`,
            isin,
          })),
          links: { next: "unused" },
        } as never;
      },
    }),
    "reverse",
    { isin },
  );
  expect(result.complete).toBe(false);
  expect(result.data).toHaveLength(100);
  expect(result).toMatchObject({
    http_status: 403,
    issues: ["pagination_interrupted", "access_denied"],
  });
});
