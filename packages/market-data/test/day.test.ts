import { describe, expect, it } from "vitest";
import examples from "../examples/valid.json";
import type { ReadResult, Series } from "../src/index";
import { dayBinding, readResultSchema } from "../src/widgets";

const rows = [
  {
    subject: { provider: "synthetic", native_id: "A", native_scope: "symbol" },
    symbol: "A",
    name: "Alpha",
  },
  {
    subject: { provider: "synthetic", native_id: "B", native_scope: "symbol" },
    symbol: "B",
    name: "Beta",
  },
];

function quote(): ReadResult {
  const value = examples.find((item) => item.name === "equity_scalar_close");
  if (!value) throw Error("Missing synthetic fixture.");
  return readResultSchema.parse(value.value);
}

function bars(): Series {
  const series = quote().series as Series;
  return {
    ...series,
    id: "series:m5",
    interval: { kind: "minute", count: 5 },
    time_anchor: "interval_start",
    read_support: {
      operations: ["history"],
      window_kind: "instant",
      max_span_seconds: 60 * 86_400,
      updates: "poll",
    },
  };
}

const done = <T>(data: T) => ({ data, error: null, isPending: false });
const waiting = { data: undefined, error: null, isPending: true };

describe("the markets overview's quotes and paths", () => {
  it("reads every quote in one resource and each source's series", () => {
    const [quotes, ...series] = dayBinding.queries({ rows });
    const arguments_ = quotes?.resource.arguments as { reads: unknown[] };
    const reads = arguments_.reads;
    expect(reads).toHaveLength(2);
    expect(series.map((query) => query.resource.arguments)).toEqual(
      rows.map((row) => ({ action: "series", binding: row.subject })),
    );
  });

  it("asks for bars only once every quote and series has answered, one read per row", () => {
    const list = done({ series: [bars()] });
    expect(dayBinding.deferred?.({ rows }, [waiting, list, list])).toEqual([]);
    const ready = [done({ results: [quote(), quote()] }), list, list];
    expect(dayBinding.deferred?.({ rows }, ready)).toHaveLength(2);
  });

  it("keeps a row whose quote failed, marked unavailable, beside a priced row", () => {
    const failed = {
      ...quote(),
      outcome: "error" as const,
      observations: [],
      series: null,
    };
    const data = dayBinding.render(
      { rows },
      [
        done({ results: [quote(), failed] }),
        done({ series: [] }),
        done({ series: [] }),
      ],
      [],
      { formatTimestamp: String },
    ).data;
    expect(data.rows.map((row) => row.status === "unavailable")).toEqual([
      false,
      true,
    ]);
    expect(data.rows[0]?.price).not.toBeNull();
    expect(data.pending).toEqual([false, false]);
  });

  const render = (primary: unknown[], deferred: unknown[] = []) =>
    dayBinding.render(
      { rows },
      primary as Parameters<typeof dayBinding.render>[1],
      deferred as Parameters<typeof dayBinding.render>[2],
      { formatTimestamp: String },
    ).data;
  const noSeries = [done({ series: [] }), done({ series: [] })];

  it("marks retained quotes stale, says so and flags the rows when updates fail", () => {
    const data = render([
      {
        data: { results: [quote(), quote()] },
        error: Error("Updates are temporarily unavailable."),
        isPending: false,
      },
      ...noSeries,
    ]);
    expect(data.rows.map((row) => row.price)).toEqual([124.1, 124.1]);
    expect(data.rows.map((row) => row.activity?.data)).toEqual([
      "stale",
      "stale",
    ]);
    expect(data.rows[0]?.statusLabel).toBe(
      "Updates unavailable · last received value",
    );
    expect(data.failed).toEqual([true, true]);
    expect(data.message).toBe(
      "Some prices could not be loaded. Any retained values are marked as stale.",
    );
  });

  it("leaves rows unavailable, not stale, when the first read fails", () => {
    const data = render([
      { data: undefined, error: Error("offline"), isPending: false },
      ...noSeries,
    ]);
    expect(data.rows.map((row) => row.activity?.data)).toEqual([
      "unavailable",
      "unavailable",
    ]);
    expect(data.failed).toEqual([true, true]);
    expect(data.message).toMatch(/^Some prices could not be loaded/);
  });

  it("gives a failed chart read to its own row when another row plans none", () => {
    const data = render(
      [
        done({ results: [quote(), quote()] }),
        done({ series: [] }),
        done({ series: [bars()] }),
      ],
      [{ data: undefined, error: Error("timeout"), isPending: false }],
    );
    expect(data.failed).toEqual([false, true]);
    expect(data.rows.map((row) => row.pathState)).toEqual([
      "unavailable",
      "unavailable",
    ]);
    expect(data.message).toBe(
      "Some charts could not be loaded. Any retained values are marked as stale.",
    );
  });

  it("counts a quote the source reports without delay as current, so a closed market reads closed", () => {
    const zero = (state: string) => {
      const value = quote();
      value.price_context = {
        delay_seconds: 0,
        session: { state, basis: "source" },
      } as ReadResult["price_context"];
      return value;
    };
    const data = render([
      done({ results: [zero("closed"), zero("regular")] }),
      ...noSeries,
    ]);
    expect(data.rows.map((row) => row.activity)).toMatchObject([
      { session: "closed", data: "current" },
      { session: "open", data: "current" },
    ]);
    expect(data.failed).toEqual([false, false]);
    expect(data.message).toBeUndefined();
  });
});
