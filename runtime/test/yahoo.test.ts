import { expect, test, vi } from "vitest";
import { execute, type Client } from "../managed/runner/yahoo.js";
test("crypto charts cross midnight using a rolling 24-hour window without a daily-close baseline", async () => {
  vi.useFakeTimers();
  const end = Date.parse("2026-01-03T06:00:00Z");
  vi.setSystemTime(end);
  try {
    const result = await execute(
      {
        operation: "dashboard",
        arguments: { kind: "charts", symbols: ["BTC-USD"] },
      },
      {
        chart: async () => ({
          meta: {
            symbol: "BTC-USD",
            instrumentType: "CRYPTOCURRENCY",
            currency: "USD",
            exchangeTimezoneName: "UTC",
            previousClose: 99,
            regularMarketTime: new Date(end),
            currentTradingPeriod: {
              regular: {
                start: new Date("2026-01-03T00:00:00Z"),
                end: new Date("2026-01-04T00:00:00Z"),
              },
            },
          },
          quotes: [-25, -24, -12, -1].map((hours) => ({
            date: new Date(end + hours * 3600000),
            close: 100 + hours,
          })),
        }),
      } as unknown as Client,
    );
    expect(result.data).toMatchObject({
      charts: [
        {
          points: [{ c: 76 }, { c: 88 }, { c: 99 }],
          window: { start: end - 86400000, end },
          range: "1d",
          interval_ms: 60000,
          session_window: null,
          previous_close: null,
          baseline_session: null,
        },
      ],
    });
  } finally {
    vi.useRealTimers();
  }
});
test.each(["pre", "post"])(
  "Yahoo %s charts retain the preceding regular session and the current continuation",
  async (phase) => {
    const epoch = (time: string) => Date.parse(`2026-01-05T${time}:00Z`);
    vi.useFakeTimers();
    vi.setSystemTime(epoch(phase === "pre" ? "12:00" : "19:00"));
    try {
      const chart = vi.fn(async () => ({
        meta: {
          symbol: "ONE",
          instrumentType: "EQUITY",
          exchangeTimezoneName: "America/New_York",
          regularMarketTime: new Date(
            phase === "pre" ? "2026-01-02T21:00:00Z" : epoch("18:00"),
          ),
          regularMarketPrice: phase === "pre" ? 100 : 110,
          previousClose: phase === "pre" ? 90 : 100,
          tradingPeriods: {
            regular: [
              [
                {
                  start: new Date("2026-01-02T14:30:00Z"),
                  end: new Date("2026-01-02T21:00:00Z"),
                },
              ],
            ],
          },
          currentTradingPeriod: {
            pre: {
              start: new Date(epoch("09:00")),
              end: new Date(epoch("14:30")),
            },
            regular: {
              start: new Date(epoch("14:30")),
              end: new Date(epoch("18:00")),
            },
            post: {
              start: new Date(epoch("18:00")),
              end: new Date(epoch("22:00")),
            },
          },
        },
        quotes: [
          { date: new Date("2026-01-02T20:59:00Z"), close: 100 },
          { date: new Date(epoch("11:59")), close: 101 },
          ...(phase === "post"
            ? [
                { date: new Date(epoch("17:59")), close: 110 },
                { date: new Date(epoch("18:01")), close: 111 },
              ]
            : []),
        ],
      }));
      const result = await execute(
        {
          operation: "dashboard",
          arguments: { kind: "charts", symbols: ["ONE"] },
        },
        { chart } as unknown as Client,
      );
      expect(chart).toHaveBeenCalledWith(
        "ONE",
        expect.objectContaining({ includePrePost: true }),
      );
      expect(result.data).toMatchObject({
        charts: [
          {
            session: "2026-01-05",
            previous_close: phase === "pre" ? 90 : 100,
            baseline_session: "2026-01-05",
            session_window:
              phase === "pre"
                ? {
                    start: Date.parse("2026-01-02T14:30:00Z"),
                    end: epoch("14:30"),
                  }
                : { start: epoch("14:30"), end: epoch("22:00") },
            regular_window:
              phase === "pre"
                ? {
                    start: Date.parse("2026-01-02T14:30:00Z"),
                    end: Date.parse("2026-01-02T21:00:00Z"),
                  }
                : { start: epoch("14:30"), end: epoch("18:00") },
            ...(phase === "pre"
              ? {
                  session_gap: {
                    start: Date.parse("2026-01-02T21:00:00Z"),
                    end: epoch("09:00"),
                  },
                }
              : {}),
            points:
              phase === "pre"
                ? [{ c: 100 }, { c: 101 }]
                : [{ c: 110 }, { c: 111 }],
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  },
);
test("Yahoo rejects arbitrary execution and unbounded requests before SDK calls", async () => {
  const chart = vi.fn();
  const sdk = { chart } as unknown as Client;
  for (const [operation, args] of [
    ["_fetch", {}],
    [
      "chart",
      { symbol: "SYNTH", options: { period1: "2020-01-01", interval: "1m" } },
    ],
    [
      "chart",
      {
        symbol: "https://example.test",
        options: { period1: "2026-09-14", period2: "2026-09-15" },
      },
    ],
  ] as const) {
    expect(
      (await execute({ operation, arguments: args }, sdk)).data,
    ).toBeNull();
  }
  expect(chart).not.toHaveBeenCalled();
});
test("Yahoo batched quotes retain missing members and reject alien identities", async () => {
  const quote = vi.fn(async () => [
    {
      symbol: "ONE",
      regularMarketPrice: 10,
      regularMarketTime: new Date("2026-01-02T12:00:00Z"),
      marketState: "REGULAR",
      exchangeDataDelayedBy: 15,
      preMarketPrice: 11,
      preMarketTime: new Date("2026-01-03T08:00:00Z"),
    },
  ]);
  const request = {
    operation: "quote_bundle",
    arguments: { symbols: ["ONE", "TWO"] },
  };
  const sdk = { quote } as unknown as Client;
  const result = await execute(request, sdk);
  expect(quote).toHaveBeenCalledTimes(1);
  expect(result.data).toMatchObject({
    common: { ONE: { metadata: { symbol: "ONE", delay: 15 } } },
    display: {
      quotes: [
        { symbol: "ONE", price: 10, metadata: { delay: 15 } },
        { symbol: "TWO", price: null },
      ],
    },
  });
  expect(result.data).not.toHaveProperty("common.TWO");
  // Old extended fields can remain present during REGULAR; do not surface them.
  expect(result.data).toMatchObject({
    display: { quotes: [{ extended: null }, {}] },
  });
  const pre = await execute(request, {
    quote: async () => [
      {
        symbol: "ONE",
        regularMarketPrice: 10,
        marketState: "PRE",
        preMarketPrice: 11,
        preMarketTime: new Date("2026-01-03T08:00:00Z"),
        postMarketPrice: 9,
        postMarketTime: new Date("2026-01-02T21:00:00Z"),
      },
    ],
  } as unknown as Client);
  expect(pre.data).toMatchObject({
    display: {
      quotes: [
        {
          price: 10,
          extended: {
            session: "pre",
            price: 11,
            timestamp: Date.parse("2026-01-03T08:00:00Z") / 1000,
          },
        },
        {},
      ],
    },
  });
  quote.mockResolvedValueOnce([
    {
      symbol: "OTHER",
      regularMarketPrice: 10,
      regularMarketTime: new Date(),
      marketState: "REGULAR",
      exchangeDataDelayedBy: 0,
    },
  ]);
  expect(await execute(request, sdk)).toMatchObject({
    data: null,
    issues: ["binding_mismatch"],
  });
});
test.each(["POSTPOST", "CLOSED", "PREPRE"])(
  "Yahoo retains the completed post quote in %s",
  async (marketState) => {
    const result = await execute(
      { operation: "quote_bundle", arguments: { symbols: ["ONE"] } },
      {
        quote: async () => [
          {
            symbol: "ONE",
            marketState,
            regularMarketPrice: 100,
            postMarketPrice: 103,
            postMarketChange: 3,
            postMarketChangePercent: 3,
            postMarketTime: new Date("2026-09-16T23:59:00Z"),
          },
        ],
      } as unknown as Client,
    );
    expect(result.data).toMatchObject({
      display: {
        quotes: [
          {
            price: 100,
            extended: {
              session: "post",
              price: 103,
              change: 3,
              percent: 3,
              timestamp: Date.parse("2026-09-16T23:59:00Z") / 1000,
            },
          },
        ],
      },
    });
  },
);
test("Yahoo charts preserve gaps, isolate failures and select the exchange-local session", async () => {
  let marketTime = new Date("2026-01-02T00:02:00Z");
  const chart = vi.fn(async (s: string) => {
    if (s === "TWO") throw Error("private upstream response");
    return {
      meta: {
        symbol: s,
        exchangeTimezoneName: "Asia/Tokyo",
        regularMarketTime: marketTime,
        previousClose: 1.5,
        chartPreviousClose: 99,
        currentTradingPeriod: {
          regular: {
            start: new Date("2026-01-03T00:00:00Z"),
            end: new Date("2026-01-03T06:00:00Z"),
          },
        },
        // Historical periods remain epoch seconds in the current SDK.
        tradingPeriods: [
          [
            {
              start: Date.parse("2026-01-02T00:00:00Z") / 1000,
              end: Date.parse("2026-01-02T03:00:00Z") / 1000,
            },
          ],
        ],
      },
      quotes: [
        { date: new Date("2026-01-01T05:00:00Z"), close: 1 },
        { date: new Date("2026-01-02T00:00:00Z"), close: 2 },
        { date: new Date("2026-01-02T00:01:00Z"), close: null },
        { date: new Date("2026-01-02T00:02:00Z"), close: 3 },
        // A late print outside the regular schedule is not extended trading.
        { date: new Date("2026-01-02T04:00:00Z"), close: 99 },
      ],
    };
  });
  const result = await execute(
    {
      operation: "dashboard",
      arguments: { kind: "charts", symbols: ["ONE", "TWO"] },
    },
    { chart } as unknown as Client,
  );
  expect(result.data).toMatchObject({
    charts: [
      {
        symbol: "ONE",
        session: "2026-01-02",
        points: [{ c: 2 }, { c: 3 }],
        previous_close: 1.5,
        baseline_session: "2026-01-02",
        session_window: {
          start: Date.parse("2026-01-02T00:00:00Z"),
          end: Date.parse("2026-01-02T03:00:00Z"),
        },
      },
      { symbol: "TWO", points: [], failure: { code: "source_unavailable" } },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("private upstream response");
  marketTime = new Date("2026-01-03T00:02:00Z");
  const stale = await execute(
    { operation: "dashboard", arguments: { kind: "charts", symbols: ["ONE"] } },
    { chart } as unknown as Client,
  );
  expect(stale.data).toMatchObject({
    charts: [{ previous_close: null, baseline_session: null }],
  });
});
test("Yahoo has no free-text search; ISIN resolve returns listing rows only", async () => {
  const search = vi.fn(async () => ({
    quotes: [
      {
        isYahooFinance: true,
        symbol: "SYNTH.AS",
        exchange: "AMS",
        quoteType: "EQUITY",
        longname: "Synthetic N.V.",
      },
      { isYahooFinance: true, symbol: "SYNTH.AS", exchange: "AMS" },
      { isYahooFinance: true, symbol: "not a symbol", exchange: "SYN" },
      { isYahooFinance: false, name: "Synthetic startup" },
    ],
    news: [{ title: "Synthetic headline" }],
  }));
  const sdk = { search } as unknown as Client;
  for (const [operation, args] of [
    ["search", { query: "Synthetic" }],
    ["resolve_isin", { isin: "Synthetic" }],
    ["resolve_isin", { isin: "NL0010273216" }],
  ] as const) {
    expect(await execute({ operation, arguments: args }, sdk)).toMatchObject({
      data: null,
      issues: ["invalid_request"],
    });
  }
  expect(search).not.toHaveBeenCalled();
  const result = await execute(
    { operation: "resolve_isin", arguments: { isin: "NL0010273215" } },
    sdk,
  );
  expect(search).toHaveBeenCalledWith(
    "NL0010273215",
    expect.objectContaining({ newsCount: 0, enableFuzzyQuery: false }),
  );
  expect(result.data).toMatchObject({
    source: "yahoo.resolve_isin",
    result: {
      isin: "NL0010273215",
      quotes: [{ symbol: "SYNTH.AS", exchange: "AMS", quoteType: "EQUITY" }],
    },
  });
  expect(JSON.stringify(result)).not.toContain("Synthetic");
});
test("Yahoo news is keyed by a validated symbol and keeps only items tagged with it", async () => {
  const search = vi.fn(async () => ({
    quotes: [{ isYahooFinance: true, symbol: "OTHER" }],
    news: [
      {
        uuid: "one",
        title: "Tagged",
        publisher: "Synthetic Wire",
        link: "https://example.test/one",
        providerPublishTime: new Date("2026-01-02T12:00:00Z"),
        type: "STORY",
        relatedTickers: ["SYNTH", "OTHER"],
      },
      { uuid: "two", title: "Untagged", relatedTickers: ["OTHER"] },
      { uuid: "three", title: "No tickers" },
    ],
  }));
  const sdk = { search } as unknown as Client;
  for (const args of [
    { symbol: "free text" },
    { symbol: "SYNTH", options: { count: 21 } },
    { symbol: "SYNTH", options: { quotesCount: 5 } },
  ])
    expect(
      await execute({ operation: "news", arguments: args }, sdk),
    ).toMatchObject({ data: null, issues: ["invalid_request"] });
  expect(search).not.toHaveBeenCalled();
  const result = await execute(
    { operation: "news", arguments: { symbol: "SYNTH" } },
    sdk,
  );
  expect(search).toHaveBeenCalledWith(
    "SYNTH",
    expect.objectContaining({ quotesCount: 0, newsCount: 10 }),
  );
  expect(result.data).toMatchObject({
    source: "yahoo.news",
    result: { symbol: "SYNTH", news: [{ uuid: "one", title: "Tagged" }] },
  });
  expect(JSON.stringify(result)).not.toContain("Untagged");
  expect(result.data).not.toHaveProperty("result.quotes");
});
test("intraday equity reads carry the current or last started session; crypto keeps elapsed time", async () => {
  const at = (time: string) => new Date(`2026-01-05T${time}:00Z`);
  const chart = vi.fn(async (_s: string, _o: unknown) => ({
    meta: {
      symbol: "SYN",
      instrumentType: "EQUITY",
      exchangeTimezoneName: "America/New_York",
      currentTradingPeriod: {
        pre: { start: at("09:00"), end: at("14:30") },
        regular: { start: at("14:30"), end: at("21:00") },
        post: { start: at("21:00"), end: new Date("2026-01-06T01:00:00Z") },
      },
      tradingPeriods: {
        pre: [
          [
            {
              start: Date.parse("2026-01-02T09:00:00Z") / 1000,
              end: Date.parse("2026-01-02T14:30:00Z") / 1000,
            },
          ],
        ],
        regular: [
          [
            {
              start: Date.parse("2026-01-02T14:30:00Z") / 1000,
              end: Date.parse("2026-01-02T21:00:00Z") / 1000,
            },
          ],
        ],
        post: [
          [
            {
              start: Date.parse("2026-01-02T21:00:00Z") / 1000,
              end: Date.parse("2026-01-03T01:00:00Z") / 1000,
            },
          ],
        ],
      },
    },
    quotes: [],
  }));
  const read = () =>
    execute(
      {
        operation: "price_read",
        arguments: {
          symbol: "SYN",
          mode: "five_minute_extended",
          start: "2026-01-01T00:00:00Z",
          end: "2026-01-05T23:00:00Z",
        },
      },
      { chart } as unknown as Client,
    );
  vi.useFakeTimers();
  try {
    // Before Monday's pre-market, Friday is the last started session.
    vi.setSystemTime(at("08:00"));
    expect((await read()).data).toMatchObject({
      session: {
        date: "2026-01-02",
        regular: { start: "2026-01-02T14:30:00.000Z" },
        extended: { end: "2026-01-03T01:00:00.000Z" },
      },
    });
    expect(chart.mock.calls[0]?.[1]).toMatchObject({ includePrePost: true });
    vi.setSystemTime(at("10:00"));
    expect((await read()).data).toMatchObject({
      session: {
        date: "2026-01-05",
        timezone: "America/New_York",
        extended: { start: "2026-01-05T09:00:00.000Z" },
      },
    });
    chart.mockImplementationOnce(
      async () =>
        ({
          meta: { symbol: "SYN", instrumentType: "CRYPTOCURRENCY" },
          quotes: [],
        }) as never,
    );
    expect((await read()).data).toMatchObject({ session: null });
  } finally {
    vi.useRealTimers();
  }
});
