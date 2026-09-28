import { expect, test, vi } from "vitest";
import { execute, type Client } from "../managed/runner/yahoo.js";
const story = (uuid: string, at: string, tags?: string[]) => ({
  uuid,
  title: `Synthetic ${uuid}`,
  publisher: "Synthetic Wire",
  link: `https://example.test/${uuid}`,
  providerPublishTime: new Date(at),
  type: "STORY",
  ...(tags ? { relatedTickers: tags } : {}),
});
test("Yahoo news reads every symbol of the issuer and keeps only items tagged with one of them", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-08T12:00:00Z"));
  const search = vi.fn(async (query: string) => ({
    quotes: [{ isYahooFinance: true, symbol: "OTHER" }],
    news:
      query === "SYNTH.AS"
        ? [] // Yahoo's text search matches no news for a home-listing symbol
        : [
            story("us", "2026-01-07T12:00:00Z", ["SYNTH", "OTHER"]),
            story("home", "2026-01-06T12:00:00Z", ["SYNTH.AS"]),
            story("untagged", "2026-01-06T12:00:00Z", ["OTHER"]),
            story("bare", "2026-01-05T12:00:00Z"),
            story("old", "2025-12-20T12:00:00Z", ["SYNTH"]),
          ],
  }));
  const sdk = { search } as unknown as Client;
  try {
    for (const args of [
      { symbol: "free text" },
      { symbol: "SYNTH", options: { count: 20 } },
      { symbol: "SYNTH", options: { quotesCount: 5 } },
      // A name query is for crypto pairs only; equities are found by symbol.
      { symbol: "SYNTH", options: { name: "Synthetic Holding" } },
      { symbol: "SYN-USD", options: { name: "Synthcoin; DROP" } },
      { symbol: "SYNTH", options: { limit: 201 } },
      { symbol: "SYNTH", symbols: ["A", "B", "C", "D", "E", "F", "G", "H"] },
    ])
      expect(
        await execute({ operation: "news", arguments: args }, sdk),
      ).toMatchObject({ data: null, issues: ["invalid_request"] });
    for (const options of [
      { from: "2026-01-09", to: "2026-01-08" },
      { from: "2025-12-01", to: "2026-01-08" },
      { from: "2026-02-30" },
    ])
      expect(
        await execute(
          { operation: "news", arguments: { symbol: "SYNTH", options } },
          sdk,
        ),
      ).toMatchObject({ data: null, issues: ["invalid_window"] });
    expect(search).not.toHaveBeenCalled();
    const result = await execute(
      {
        operation: "news",
        arguments: { symbol: "SYNTH.AS", symbols: ["SYNTH"] },
      },
      sdk,
    );
    expect(search.mock.calls.map(([query]) => query)).toEqual([
      "SYNTH.AS",
      "SYNTH",
    ]);
    expect(search).toHaveBeenCalledWith(
      "SYNTH",
      expect.objectContaining({ quotesCount: 0, newsCount: 50 }),
    );
    // SYNTH's answer reaches back past the window start, so nothing is missing.
    expect(result.issues).toEqual([]);
    expect(result.data).toMatchObject({
      source: "yahoo.news",
      result: {
        symbol: "SYNTH.AS",
        symbols: ["SYNTH.AS", "SYNTH"],
        window: { from: "2026-01-02", to: "2026-01-08" },
        complete_from: null,
        outside_window: 1,
        queries: [
          { query: "SYNTH.AS", returned: 0, stops_in_window: false },
          { query: "SYNTH", returned: 5, stops_in_window: false },
        ],
        news: [
          {
            uuid: "us",
            matched: ["SYNTH"],
            published_at: "2026-01-07T12:00:00.000Z",
          },
          { uuid: "home", matched: ["SYNTH.AS"] },
        ],
      },
    });
    const text = JSON.stringify(result);
    for (const dropped of ["untagged", "bare", "Synthetic old"])
      expect(text).not.toContain(dropped);
    expect(result.data).not.toHaveProperty("result.quotes");
  } finally {
    vi.useRealTimers();
  }
});
test("a crypto pair also queries its name; the name never widens what is kept", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-08T12:00:00Z"));
  const search = vi.fn(async (query: string) => ({
    quotes: [],
    news:
      query === "SYN-USD"
        ? [story("pair", "2025-11-01T12:00:00Z", ["SYN-USD"])]
        : [
            story("named", "2026-01-07T12:00:00Z", ["SYN-USD", "ETH-USD"]),
            story("other", "2026-01-07T11:00:00Z", ["ETH-USD"]),
          ],
  }));
  try {
    const result = await execute(
      {
        operation: "news",
        arguments: { symbol: "SYN-USD", options: { name: "Synthcoin" } },
      },
      { search } as unknown as Client,
    );
    expect(search.mock.calls.map(([query]) => query)).toEqual([
      "SYN-USD",
      "Synthcoin",
    ]);
    expect(result.data).toMatchObject({
      result: {
        name: "Synthcoin",
        news: [{ uuid: "named", matched: ["SYN-USD"] }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("Synthetic other");
  } finally {
    vi.useRealTimers();
  }
});
test("Yahoo news states where an answer stops inside the window and reports drift", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-08T12:00:00Z"));
  // Twenty items, fewer than today's cap: the stop is read from the answer.
  const page = Array.from({ length: 20 }, (_, index) => ({
    ...story(
      `item-${index}`,
      new Date(
        Date.parse("2026-01-08T11:00:00Z") - index * 3_600_000,
      ).toISOString(),
      ["SYNTH"],
    ),
    type: index === 0 ? "PODCAST" : "STORY",
    ...(index === 1 ? { sentimentScore: 1 } : {}),
  }));
  const search = vi.fn(async () => ({
    quotes: [],
    news: [
      ...page,
      { uuid: "broken", title: "No link", relatedTickers: ["SYNTH"] },
    ],
  }));
  try {
    const result = await execute(
      {
        operation: "news",
        arguments: { symbol: "SYNTH", options: { limit: 10 } },
      },
      { search } as unknown as Client,
    );
    expect(result.issues).toEqual([
      "invalid_value",
      "schema_drift",
      "window_incomplete",
      "truncated",
    ]);
    expect(result.data).toMatchObject({
      result: {
        complete_from: "2026-01-07T16:00:00.000Z",
        queries: [
          {
            query: "SYNTH",
            kind: "symbol",
            returned: 21,
            stops_in_window: true,
          },
        ],
        drift: {
          unknown_fields: ["sentimentScore"],
          unknown_types: ["PODCAST"],
          unreadable_items: 1,
        },
      },
    });
    expect(
      (result.data as { result: { news: unknown[] } }).result.news,
    ).toHaveLength(10);
  } finally {
    vi.useRealTimers();
  }
});
