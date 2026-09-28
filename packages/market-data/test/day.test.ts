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
});
