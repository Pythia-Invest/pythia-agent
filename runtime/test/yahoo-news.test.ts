import { expect, test, vi } from "vitest";
import { execute, type Client } from "../managed/runner/yahoo.js";
test("Yahoo news reads the issuer's symbols and name and keeps only items tagged with one of them", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-08T12:00:00Z"));
  const story = (uuid: string, day: string, tags?: string[]) => ({
    uuid,
    title: `Synthetic ${uuid}`,
    publisher: "Synthetic Wire",
    link: `https://example.test/${uuid}`,
    providerPublishTime: new Date(`2026-01-${day}T12:00:00Z`),
    type: "STORY",
    ...(tags ? { relatedTickers: tags } : {}),
  });
  const search = vi.fn(async (query: string) => ({
    quotes: [{ isYahooFinance: true, symbol: "OTHER" }],
    news:
      query === "SYNTH.AS"
        ? [] // Yahoo's text search matches no news for a home-listing symbol
        : query === "SYNTH"
          ? [
              story("us", "07", ["SYNTH", "OTHER"]),
              story("old", "01", ["SYNTH"]),
            ]
          : [
              story("us", "07", ["SYNTH", "OTHER"]),
              story("name", "06", ["SYNTH.AS"]),
              story("untagged", "06", ["OTHER"]),
              story("bare", "05"),
            ],
  }));
  const sdk = { search } as unknown as Client;
  try {
    for (const args of [
      { symbol: "free text" },
      { symbol: "SYNTH", options: { count: 20 } },
      { symbol: "SYNTH", options: { quotesCount: 5 } },
      { symbol: "SYNTH", options: { name: "Synthetic; DROP" } },
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
        arguments: {
          symbol: "SYNTH.AS",
          symbols: ["SYNTH"],
          options: { name: "Synthetic Holding N.V." },
        },
      },
      sdk,
    );
    expect(search.mock.calls.map(([query]) => query)).toEqual([
      "SYNTH.AS",
      "SYNTH",
      "Synthetic Holding N.V.",
    ]);
    expect(search).toHaveBeenCalledWith(
      "SYNTH",
      expect.objectContaining({ quotesCount: 0, newsCount: 50 }),
    );
    expect(result.issues).toEqual([]);
    expect(result.data).toMatchObject({
      source: "yahoo.news",
      result: {
        symbol: "SYNTH.AS",
        symbols: ["SYNTH.AS", "SYNTH"],
        window: { from: "2026-01-02", to: "2026-01-08" },
        complete_from: null,
        outside_window: 1,
        news: [
          {
            uuid: "us",
            matched: ["SYNTH"],
            published_at: "2026-01-07T12:00:00.000Z",
          },
          { uuid: "name", matched: ["SYNTH.AS"] },
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
test("Yahoo news states where its per-query cap may hide items and reports drift", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-08T12:00:00Z"));
  const full = Array.from({ length: 50 }, (_, index) => ({
    uuid: `item-${index}`,
    title: `Synthetic ${index}`,
    publisher: "Synthetic Wire",
    link: `https://example.test/${index}`,
    providerPublishTime: new Date(
      Date.parse("2026-01-08T11:00:00Z") - index * 3_600_000,
    ),
    type: index === 0 ? "PODCAST" : "STORY",
    relatedTickers: ["SYNTH"],
    ...(index === 1 ? { sentimentScore: 1 } : {}),
  }));
  const search = vi.fn(async () => ({
    quotes: [],
    news: [
      ...full,
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
        complete_from: "2026-01-06T10:00:00.000Z",
        queries: [
          { query: "SYNTH", kind: "symbol", returned: 51, capped: true },
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
