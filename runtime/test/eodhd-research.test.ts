// Synthetic fixtures shaped by official EODHD endpoint docs and SDK1.1.0.
import { expect, test, vi } from "vitest";
import { EODHDClient } from "eodhd";
import { run } from "../managed/runner/eodhd-market-data.js";
import {
  execute,
  type Client,
} from "../managed/runner/eodhd-market-data-operations.js";
import { financialFacts } from "../managed/runner/eodhd-market-data-fundamentals.js";

const reference = {
  provider: "eodhd",
  native_scope: "catalogue",
  native_id: "SYNTH.US",
  qualifiers: { currency: "USD" },
};
const listing = {
  Code: "SYNTH",
  Exchange: "NASDAQ",
  Name: "Synthetic Corp",
  Type: "Common Stock",
  Currency: "USD",
};
const fake = (methods: Partial<Client>) => methods as Client;

test("catalogue snapshot keeps US namespace separate from venue, is versioned and bounded", async () => {
  const sdk = fake({ exchanges: { symbols: async () => [listing] } as never });
  const first = await execute(sdk, "catalogue_snapshot", { scope: "NASDAQ" });
  expect(first.data).toMatchObject({
    scope: "NASDAQ",
    rows: [{ symbol: "SYNTH.US", actual_venue: "NASDAQ" }],
  });
  const next = await execute(sdk, "catalogue_snapshot", { scope: "NASDAQ" });
  expect((next.data as { version: string }).version).toBe(
    (first.data as { version: string }).version,
  );
  await expect(
    execute(sdk, "catalogue_snapshot", { scope: "US" }),
  ).rejects.toThrow("invalid_request");
});

test("Euronext Amsterdam catalogue keeps the exchange namespace and source ISIN", async () => {
  // Exchange-symbol-list rows name the identifier field "Isin".
  const previous = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = vi.fn(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json([
      {
        ...listing,
        Exchange: "AS",
        Currency: "EUR",
        Isin: "US0378331005",
      },
    ]);
  });
  try {
    const result = await execute(
      new EODHDClient({ apiToken: "synthetic", maxRetries: 0 }),
      "catalogue_snapshot",
      { scope: "AS" },
    );
    expect(calls.map((url) => url.pathname)).toEqual([
      "/api/exchange-symbol-list/AS",
    ]);
    expect(result.data).toMatchObject({
      scope: "AS",
      rows: [
        {
          symbol: "SYNTH.AS",
          actual_venue: "AS",
          currency: "EUR",
          isin: "US0378331005",
        },
      ],
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("news retains publications and multiple symbols, excludes bodies and unsafe links", async () => {
  const sdk = fake({
    news: async (args) => {
      expect(args).toEqual({
        s: "SYNTH.US",
        limit: 2,
        offset: 0,
        from: "2026-01-01",
        to: "2026-01-03",
      });
      return [
        {
          title: "Synthetic news",
          link: "https://example.test/story",
          date: "2026-01-02T15:00:00+02:00",
          symbols: ["SYNTH.US", "OTHER.US"],
          content: "Private full text",
        },
        {
          title: "Bad link",
          link: "javascript:alert(1)",
          date: "2026-01-02",
          symbols: [],
        },
      ] as never;
    },
  });
  const result = await execute(sdk, "news", {
    native_ref: reference,
    limit: 2,
    from: "2026-01-01",
    to: "2026-01-03",
  });
  expect(result.data).toMatchObject({
    dataset: "news",
    provider_ref: reference,
    articles: [
      {
        published_at: "2026-01-02T13:00:00.000Z",
        symbols: ["SYNTH.US", "OTHER.US"],
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("Private full text");
  expect(result.issues).toEqual(["invalid_value"]);
});

test("recent news sends a bounded UTC calendar window before any provider work", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-02T00:30:00+01:00"));
  const news = vi.fn(async () => []);
  try {
    const result = await execute(fake({ news }), "news", {
      native_ref: reference,
      limit: 8,
    });
    expect(news).toHaveBeenCalledExactlyOnceWith({
      s: "SYNTH.US",
      limit: 8,
      offset: 0,
      from: "2025-12-02",
      to: "2026-01-01",
    });
    expect(result.data).toMatchObject({
      window: { start: "2025-12-02", end: "2026-01-01" },
      source_url: expect.stringContaining("from=2025-12-02"),
    });
    for (const window of [
      { from: "2026-01-05", to: "2026-01-01" },
      { from: "2026-02-30" },
      { from: "2024-01-01", to: "2026-01-01" },
    ])
      await expect(
        execute(fake({ news }), "news", { native_ref: reference, ...window }),
      ).rejects.toThrow("invalid_window");
    expect(news).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("invalid news siblings do not poison a valid shared research result", async () => {
  const article = {
    title: "Synthetic news",
    link: "https://example.test/story",
    date: "2026-01-02T15:00:00Z",
    symbols: ["SYNTH.US", "", "bad\nvalue"],
  };
  const sdk = fake({
    news: async () =>
      [
        article,
        { ...article, link: "http://example.test/legacy" },
        { ...article, date: "unknown" },
      ] as never,
  });
  const result = await execute(sdk, "news", {
    native_ref: reference,
    limit: 3,
  });
  expect(result.data).toMatchObject({ articles: [{ symbols: ["SYNTH.US"] }] });
  expect(result.issues).toEqual(["invalid_value"]);
});

test("fundamentals shared limit bounds actual facts", async () => {
  const sdk = fake({
    fundamentals: async () => ({
      Income_Statement: {
        yearly: {
          p: {
            date: "2025-12-31",
            currency_symbol: "USD",
            totalRevenue: "1000",
            netIncome: "-5",
          },
        },
      },
      Balance_Sheet: {
        yearly: {
          p: {
            date: "2025-12-31",
            currency_symbol: "USD",
            totalAssets: "1200",
          },
        },
      },
    }),
  });
  const result = await execute(sdk, "fundamentals", {
    native_ref: reference,
    limit: 2,
  });
  expect(result.data).toMatchObject({
    facts: [expect.any(Object), expect.any(Object)],
    limitations: expect.arrayContaining([
      expect.stringContaining("2 newest supported facts"),
    ]),
  });
});

test("statement periods preserve negative values, source taxonomy and unknown starts", () => {
  const facts = financialFacts({
    Income_Statement: {
      yearly: {
        p: {
          date: "2025-09-30",
          filing_date: "2025-11-01",
          currency_symbol: "USD",
          totalRevenue: "1000.5",
          netIncome: "-2.5",
        },
      },
      quarterly: {
        q: { date: "2025-06-30", currency_symbol: "USD", totalRevenue: null },
      },
    },
  });
  expect(facts).toHaveLength(2);
  expect(facts[1]).toMatchObject({
    taxonomy: "eodhd",
    concept: "Income_Statement.netIncome",
    value: "-2.5",
    unit: "USD",
    period: { kind: "duration", end: "2025-09-30", frequency: "annual" },
  });
  expect(facts[1]?.period).not.toHaveProperty("start");
});

test("fundamentals entitlement failure remains403, never calls another endpoint", async () => {
  const previous = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = vi.fn(async (input) => {
    calls.push(new URL(String(input)));
    return new Response("private account response", { status: 403 });
  });
  try {
    const result = await run({
      token: "synthetic",
      operation: "fundamentals",
      arguments: { native_ref: reference },
    });
    expect(result).toMatchObject({
      data: null,
      issues: ["access_denied"],
      http_status: 403,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.searchParams.get("filter")).toBe("Financials");
    expect(JSON.stringify(result)).not.toContain("private account");
  } finally {
    globalThis.fetch = previous;
  }
});
