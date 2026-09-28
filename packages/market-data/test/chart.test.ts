import { describe, expect, it } from "vitest";
import examples from "../examples/valid.json";
import type { ReadResult, Series } from "../src/index";
import {
  chartBinding,
  chartPlan,
  readResultSchema,
  type ChartWidgetInput,
  type InstrumentChartData,
} from "../src/widgets";
import { downsample, periodPath } from "../src/widgets/chart-path";

const NOW = Date.parse("2026-09-26T10:00:00Z");
const subject = {
  provider: "synthetic",
  native_id: "SYN",
  native_scope: "symbol",
};

function fixture(): ReadResult {
  const value = examples.find((item) => item.name === "equity_scalar_close");
  if (!value) throw Error("Missing synthetic fixture.");
  return readResultSchema.parse(value.value);
}

/** A synthetic declared series: interval, span and session vary per case. */
function declared(
  id: string,
  interval: Series["interval"],
  days: number,
  session: Series["session"] = "regular",
): Series {
  const series = fixture().series;
  if (!series) throw Error("Missing synthetic series.");
  return {
    ...series,
    id: `series:${id}`,
    subject,
    provider_ref: subject,
    interval,
    session,
    time_anchor: interval.kind === "day" ? "session_date" : "interval_start",
    read_support: {
      operations: ["history"],
      window_kind: interval.kind === "day" ? "session_date" : "instant",
      max_span_seconds: days * 86_400,
      updates: "poll",
    },
  };
}

describe("chart periods follow the series a source declares", () => {
  it("chooses bars per period: extended 1D, regular multi-day, daily and weekly", () => {
    const plan = chartPlan(
      [
        declared("m1", { kind: "minute", count: 1 }, 7),
        declared("m2x", { kind: "minute", count: 2 }, 60, "extended"),
        declared("m5", { kind: "minute", count: 5 }, 60),
        declared("m30", { kind: "minute", count: 30 }, 60),
        declared("d1", { kind: "day", count: 1 }, 36600),
        declared("w1", { kind: "day", count: 7 }, 36600),
      ],
      NOW,
    );
    expect(plan.reads.get("1D")?.series.id).toBe("series:m2x");
    // Multi-day views use regular sessions only.
    expect(plan.reads.get("5D")?.series.id).toBe("series:m5");
    expect(plan.reads.get("1M")?.series.id).toBe("series:m30");
    for (const period of ["6M", "YTD", "1Y"] as const)
      expect(plan.reads.get(period)).toBe(plan.year);
    expect(plan.reads.get("5Y")?.series.id).toBe("series:w1");
    expect(plan.reads.get("MAX")).toMatchObject({
      series: { id: "series:w1" },
      days: 36600,
    });
    expect(plan.unavailable.size).toBe(0);
  });

  it("serves EODHD-like spans: 7 days intraday, 366 days daily", () => {
    const plan = chartPlan(
      [
        declared("m1", { kind: "minute", count: 1 }, 7, "unknown"),
        declared("m5", { kind: "minute", count: 5 }, 7, "unknown"),
        declared("h1", { kind: "hour", count: 1 }, 7, "unknown"),
        declared("d1", { kind: "day", count: 1 }, 366),
      ],
      NOW,
    );
    expect(plan.reads.get("5D")).toMatchObject({
      series: { id: "series:m5" },
      days: 7,
    });
    for (const period of ["1M", "6M", "YTD", "1Y"] as const)
      expect(plan.reads.get(period)).toBe(plan.year);
    expect(plan.year?.days).toBe(366);
    expect(plan.unavailable.get("5Y")).toMatch(/at most 366 days/u);
  });

  it("uses CoinGecko's 5-minute day for 1D and hourly samples for 5D and 1M", () => {
    const plan = chartPlan(
      [
        declared("s5m", { kind: "minute", count: 5 }, 1, "all"),
        declared("o30m", { kind: "minute", count: 30 }, 1, "all"),
        declared("s1h", { kind: "hour", count: 1 }, 90, "all"),
        // Paid plans add hourly candles over 31 days: too short for 1M.
        declared("o1h", { kind: "hour", count: 1 }, 31, "all"),
        declared("o4h", { kind: "hour", count: 4 }, 7, "all"),
        declared("d1", { kind: "day", count: 1 }, 90, "all"),
      ],
      NOW,
      true,
    );
    expect(plan.reads.get("1D")).toMatchObject({
      series: { id: "series:s5m" },
      days: 1,
    });
    expect(plan.reads.get("5D")?.series.id).toBe("series:s1h");
    expect(plan.reads.get("1M")?.series.id).toBe("series:s1h");
  });

  it("names periods beyond a short daily history instead of stretching it", () => {
    const plan = chartPlan(
      [
        declared("m15", { kind: "minute", count: 15 }, 7),
        declared("d1", { kind: "day", count: 1 }, 90),
      ],
      NOW,
      true,
    );
    // 15-minute bars cover 5D; a month falls back to daily bars.
    expect(plan.reads.get("5D")?.series.id).toBe("series:m15");
    expect(plan.reads.get("1M")?.days).toBe(90);
    expect(plan.reads.get("MAX")?.days).toBe(90);
    for (const period of ["6M", "YTD", "1Y", "5Y"] as const)
      expect(plan.unavailable.get(period)).toMatch(/at most 90 days/u);
  });
});

function read(
  series: Series,
  times: string[],
  context?: ReadResult["price_context"],
): ReadResult {
  const result = fixture();
  result.series = series;
  result.request.view = { kind: "source", series_id: series.id };
  result.selection.view = result.request.view;
  result.request.window = {
    start: { kind: "instant", value: "2026-09-21T10:00:00Z" },
    end: { kind: "instant", value: "2026-09-26T10:00:00Z" },
  };
  result.observations = times.map((value, index) => ({
    shape: "scalar",
    time: { kind: "instant", value },
    interval: null,
    completion: { state: "unknown", basis: "unknown" },
    value: String(100 + index),
  }));
  result.returned_window = {
    start: result.observations[0]?.time ?? null,
    end: result.observations.at(-1)?.time ?? null,
  };
  if (context) result.price_context = context;
  else delete result.price_context;
  return result;
}

function render(
  input: ChartWidgetInput,
  quote: ReadResult,
  list: Series[],
  history: ReadResult,
) {
  const done = <T>(data: T) => ({ data, error: null, isPending: false });
  return chartBinding.render(
    input,
    [done({ result: quote, refreshAfterSeconds: 60 }), done({ series: list })],
    [done({ result: history, refreshAfterSeconds: 60 })],
    { formatTimestamp: String },
  ).data as InstrumentChartData;
}

describe("the default 1D view", () => {
  const intraday = declared("m5", { kind: "minute", count: 5 }, 60);
  const session = {
    date: "2026-09-25",
    timezone: "Europe/Amsterdam",
    regular: { start: "2026-09-25T07:00:00Z", end: "2026-09-25T15:30:00Z" },
    extended: { start: "2026-09-25T07:00:00Z", end: "2026-09-25T15:30:00Z" },
  };
  const history = read(
    intraday,
    ["2026-09-24T15:00:00Z", "2026-09-25T07:00:00Z", "2026-09-25T12:00:00Z"],
    { session_window: session },
  );
  const input: ChartWidgetInput = {
    subject,
    symbol: "SYN",
    name: "Synthetic",
    period: "1D",
  };
  function quote(time: string) {
    const value = read(
      declared("latest", { kind: "tick", count: 1 }, 1),
      [time],
      {
        reference_close: {
          value: "99",
          unit: { kind: "currency", code: "EUR", scale: "1" },
          time: { kind: "unknown" },
          provider_ref: subject,
          dataset: "Synthetic:previous-close",
          retrieved_at: "2026-09-25T15:40:00Z",
        },
      },
    );
    value.request.operation = "latest";
    return value;
  }

  it("draws the supplied session with its previous close, keeping unfilled hours", () => {
    const data = render(
      input,
      quote("2026-09-25T15:35:00Z"),
      [intraday],
      history,
    );
    expect(data.item.path?.points.map((p) => p.value)).toEqual([101, 102]);
    expect(data.item.path?.session).toEqual({
      start: Date.parse(session.regular.start),
      end: Date.parse(session.regular.end),
    });
    expect(data.item.path?.baseline?.value).toBe(99);
    expect(data.periodChange).toBeUndefined();
  });

  it("shows the prior session, its omitted night and today's pre-market before the open", () => {
    const extended = declared(
      "m5x",
      { kind: "minute", count: 5 },
      7,
      "extended",
    );
    const early = {
      date: "2026-09-25",
      timezone: "America/New_York",
      regular: { start: "2026-09-25T13:30:00Z", end: "2026-09-25T20:00:00Z" },
      extended: { start: "2026-09-25T08:00:00Z", end: "2026-09-26T00:00:00Z" },
      previous: {
        regular: { start: "2026-09-24T13:30:00Z", end: "2026-09-24T20:00:00Z" },
        extended: {
          start: "2026-09-24T08:00:00Z",
          end: "2026-09-25T00:00:00Z",
        },
      },
    };
    const bars = read(
      extended,
      ["2026-09-24T14:00:00Z", "2026-09-24T22:00:00Z", "2026-09-25T09:00:00Z"],
      { session_window: early },
    );
    const data = render(input, quote("2026-09-24T20:00:00Z"), [extended], bars);
    // The prior session keeps its after-hours trades before the omitted night.
    expect(data.item.path?.points.map((p) => p.value)).toEqual([100, 101, 102]);
    expect(data.item.path?.regularSession?.end).toBe(
      Date.parse("2026-09-24T20:00:00Z"),
    );
    expect(data.item.path?.sessionGap).toEqual({
      start: Date.parse("2026-09-25T00:00:00Z"),
      end: Date.parse("2026-09-25T08:00:00Z"),
    });
    expect(data.item.path?.session?.end).toBe(
      Date.parse("2026-09-25T13:30:00Z"),
    );
    expect(data.item.path?.baseline?.value).toBe(99);
  });

  it("does not borrow another session's previous close", () => {
    const data = render(
      input,
      quote("2026-09-24T15:35:00Z"),
      [intraday],
      history,
    );
    expect(data.item.path?.baseline).toBeUndefined();
  });

  it("joins the last five regular sessions and measures from the close before them", () => {
    const days = ["17", "18", "21", "22", "23", "24"].flatMap((d) => [
      `2026-09-${d}T08:00:00Z`,
      `2026-09-${d}T15:00:00Z`,
    ]);
    const bars = read(intraday, days, { session_window: session });
    const data = render(
      { ...input, period: "5D" },
      quote("2026-09-25T15:35:00Z"),
      [intraday],
      bars,
    );
    const path = data.item.path;
    // Five sessions from the 18th; the 17th's last bar is the baseline.
    expect(path?.points).toHaveLength(10);
    expect(path?.baseline?.value).toBe(101);
    expect(path?.sessionGaps).toHaveLength(4);
    expect(path?.window).toBeUndefined();
    expect(data.periodChange).toMatchObject({
      absolute: 10,
      label: "Past 5 days",
    });
  });
});

describe("drawing budget and missing schedules", () => {
  it("downsamples to real observations, keeping both ends", () => {
    const list = Array.from({ length: 3000 }, (_, i) => ({
      time: i,
      value: Math.sin(i / 50),
    }));
    const kept = downsample(list);
    expect(kept).toHaveLength(800);
    expect([kept[0], kept.at(-1)]).toEqual([list[0], list.at(-1)]);
    expect(kept.every((p) => list[p.time] === p)).toBe(true);
  });

  it("shows the last returned session when the source has no schedule", () => {
    const series = declared("m5", { kind: "minute", count: 5 }, 60);
    const bars = read(series, [
      "2026-09-24T14:00:00Z",
      "2026-09-25T14:00:00Z",
      "2026-09-25T15:00:00Z",
    ]);
    const path = periodPath("1D", bars, undefined, false);
    expect(path.path?.points.map((p) => p.value)).toEqual([101, 102]);
  });

  it("draws a round-the-clock market without a schedule as the past 24 hours", () => {
    const series = declared("m5", { kind: "minute", count: 5 }, 60);
    const now = Date.parse("2026-09-28T00:30:00Z");
    const times = Array.from({ length: 2 * 288 }, (_, i) =>
      new Date(now - (2 * 288 - i) * 300_000).toISOString(),
    );
    const path = periodPath(
      "1D",
      read(series, times),
      undefined,
      false,
      now,
    ).path;
    expect(path?.window).toEqual({ start: now - 86_400_000, end: now });
    expect(path?.points.length).toBeGreaterThan(280);
  });

  it("keeps EODHD's year across a leap day", () => {
    const eodhd = [declared("d1", { kind: "day", count: 1 }, 366)];
    for (const at of ["2028-09-28T10:00:00Z", "2028-03-01T10:00:00Z"])
      expect(chartPlan(eodhd, Date.parse(at)).reads.get("1Y")).toBeDefined();
  });

  it("ends a weekend market's 24 hours at its last trade", () => {
    const series = declared("m2", { kind: "minute", count: 2 }, 60);
    // Trades from Monday 22:00 to Friday 21:58 UTC; it is now Sunday.
    const start = Date.parse("2026-09-20T22:00:00Z");
    const end = Date.parse("2026-09-25T21:58:00Z");
    const times = Array.from({ length: (end - start) / 120_000 + 1 }, (_, i) =>
      new Date(start + i * 120_000).toISOString(),
    );
    const path = periodPath(
      "1D",
      read(series, times),
      undefined,
      false,
      Date.parse("2026-09-27T12:00:00Z"),
    ).path;
    expect(path?.window?.end).toBe(end);
    expect(path?.points.length).toBeGreaterThan(700);
  });

  it("keeps a midday break inside one session", () => {
    const series = declared("m5", { kind: "minute", count: 5 }, 60);
    const times = [
      "2026-09-25T00:00:00Z",
      "2026-09-25T05:55:00Z",
      "2026-09-28T00:00:00Z",
      "2026-09-28T02:25:00Z",
      // One-hour lunch break, then the afternoon.
      "2026-09-28T03:30:00Z",
      "2026-09-28T04:30:00Z",
    ];
    const path = periodPath(
      "1D",
      read(series, times),
      undefined,
      false,
      Date.parse("2026-09-28T04:31:00Z"),
    ).path;
    expect(path?.points.map((p) => p.value)).toEqual([102, 103, 104, 105]);
  });
});
