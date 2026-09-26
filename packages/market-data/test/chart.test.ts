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
  it("chooses the finest bounded intraday bars and shares one year of daily bars", () => {
    const plan = chartPlan(
      [
        declared("m1", { kind: "minute", count: 1 }, 7),
        declared("m5", { kind: "minute", count: 5 }, 7),
        declared("m5x", { kind: "minute", count: 5 }, 7, "extended"),
        declared("d1", { kind: "day", count: 1 }, 3660),
      ],
      NOW,
    );
    // One-minute bars over five days exceed the drawing bound; extended
    // hours win among equal intervals.
    expect(plan.reads.get("1D")?.series.id).toBe("series:m5x");
    expect(plan.reads.get("5D")?.series.id).toBe("series:m5x");
    for (const period of ["1M", "6M", "YTD", "1Y"] as const)
      expect(plan.reads.get(period)).toBe(plan.year);
    expect(plan.year?.days).toBe(370);
    expect(plan.reads.get("5Y")?.days).toBeGreaterThan(1826);
    expect(plan.reads.get("MAX")?.days).toBe(3660);
    expect(plan.unavailable.size).toBe(0);
  });

  it("names periods beyond a short daily history instead of stretching it", () => {
    const plan = chartPlan(
      [
        declared("m15", { kind: "minute", count: 15 }, 7),
        declared("d1", { kind: "day", count: 1 }, 90),
      ],
      NOW,
    );
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
  const intraday = declared("m5", { kind: "minute", count: 5 }, 7);
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
    expect(data.item.path?.timeZone).toBe("Europe/Amsterdam");
    expect(data.periodChange).toBeUndefined();
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

  it("uses elapsed time and states the basis for other periods", () => {
    const data = render(
      { ...input, period: "5D" },
      quote("2026-09-25T15:35:00Z"),
      [intraday],
      history,
    );
    expect(data.item.path?.window?.end).toBe(
      Date.parse("2026-09-26T10:00:00Z"),
    );
    expect(data.item.path?.points).toHaveLength(3);
    expect(data.periodChange).toMatchObject({
      absolute: 2,
      label: "Past 5 days",
    });
  });
});
