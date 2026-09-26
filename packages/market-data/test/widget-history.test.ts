import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import examples from "../examples/valid.json";
import type { ReadResult, Series } from "../src/index";
import {
  financialBinding,
  financialInput,
  financialInstrument,
  financialQueryKey,
  financialSourceSchema,
  readResultSchema,
  type FinancialRow,
} from "../src/widgets";

const row: FinancialRow = {
  subject: { kind: "listing", id: "listing:provisional:synthetic:symbol:history" },
  symbol: "FIX",
  name: "Synthetic history",
  price: { mode: "preferred", criteria: {} },
  history: {
    selection: { mode: "preferred", criteria: {} },
    window: { kind: "rolling", days: 3 },
    completion: "any",
  },
};

/** Synthetic extensions of equity_scalar_close, shaped by the native wire
 * contract. A supplied Jan 6 session does not own Jan 5–7 request coverage. */
function history(kind: Series["interval"]["kind"]): ReadResult {
  const fixture = examples.find(
    (example) => example.name === "equity_scalar_close",
  );
  if (!fixture) throw Error("Missing synthetic scalar fixture.");
  const result = readResultSchema.parse(fixture.value);
  if (!result.series) throw Error("Missing synthetic series.");
  result.series.subject = row.subject;
  result.series.interval = { kind, count: 1 };
  result.series.time_anchor = "instant";
  result.request.view = { kind: "pythia", subject: row.subject };
  result.selection.view = result.request.view;
  result.selection.reason = "preference";
  result.request.window = {
    start: { kind: "instant", value: "2026-01-05T00:00:00Z" },
    end: { kind: "instant", value: "2026-01-08T00:00:00Z" },
  };
  result.observations = [
    "2026-01-05T15:00:00Z",
    "2026-01-06T15:00:00Z",
    "2026-01-06T16:00:00Z",
    "2026-01-07T15:00:00Z",
  ].map((value, index) => ({
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
  result.price_context = {
    session_window: {
      date: "2026-01-06",
      timezone: "America/New_York",
      regular: { start: "2026-01-06T14:30:00Z", end: "2026-01-06T21:00:00Z" },
      extended: { start: "2026-01-06T09:00:00Z", end: "2026-01-07T01:00:00Z" },
    },
  };
  return result;
}

function dateHistory() {
  const result = history("day");
  if (!result.series) throw Error("Missing synthetic series.");
  result.series.time_anchor = "session_date";
  result.observations = result.observations
    .filter((_, index) => index !== 2)
    .map((observation) => ({
      ...observation,
      time: {
        kind: "session_date",
        value:
          observation.time.kind === "instant"
            ? observation.time.value.slice(0, 10)
            : "",
      },
    }));
  result.request.window = {
    start: { kind: "session_date", value: "2026-01-05" },
    end: { kind: "session_date", value: "2026-01-08" },
  };
  result.returned_window = {
    start: result.observations[0]?.time ?? null,
    end: result.observations.at(-1)?.time ?? null,
  };
  return result;
}

function oneDayHistory() {
  const result = history("minute");
  result.observations = result.observations.slice(1, 3);
  result.request.window = {
    start: { kind: "instant", value: "2026-01-06T00:00:00Z" },
    end: { kind: "instant", value: "2026-01-07T00:00:00Z" },
  };
  result.returned_window = {
    start: result.observations[0]?.time ?? null,
    end: result.observations.at(-1)?.time ?? null,
  };
  return result;
}

function view(
  presentation: "session" | "window",
  kind: "rolling" | "sessions" = "rolling",
): FinancialRow {
  if (!row.history) throw Error("Missing synthetic history configuration.");
  return {
    ...row,
    history: { ...row.history, window: { kind, days: 3 }, presentation },
  };
}

function path(result: ReadResult, subject = row) {
  const value = financialInstrument(
    subject,
    undefined,
    result,
    false,
    String,
  ).path;
  if (!value) throw Error("Valid supplied history lost its path.");
  return value;
}

describe("financial history presentation", () => {
  it("uses native-valid fixtures for unbucketed and timed history", () => {
    const source = fileURLToPath(
      new URL("../../../runtime/managed/plugins/market-data", import.meta.url),
    );
    execFileSync(
      "python3",
      [
        "-c",
        [
          "import json, sys",
          "sys.path.insert(0, sys.argv[1])",
          "from wire import validate",
          "for value in json.load(sys.stdin): validate('read_result', value)",
        ].join("\n"),
        source,
      ],
      {
        input: JSON.stringify([
          history("tick"),
          history("unknown"),
          history("minute"),
          dateHistory(),
          oneDayHistory(),
        ]),
      },
    );
  });

  it.each(["tick", "unknown"] as const)(
    "retains %s history without inventing a zero duration",
    (kind) => {
      expect(path(history(kind)).intervalMs).toBeUndefined();
    },
  );

  it("retains a supplied positive bucket duration", () => {
    expect(path(history("minute")).intervalMs).toBe(60_000);
  });

  it.each(["rolling", "sessions"] as const)(
    "preserves the entire %s window despite one supplied session",
    (kind) => {
      const result = kind === "rolling" ? history("minute") : dateHistory();
      const chart = path(result, view("window", kind));
      expect(chart.points.map((point) => point.time)).toEqual(
        result.observations.map((observation) =>
          observation.time.kind === "unknown"
            ? NaN
            : Date.parse(observation.time.value),
        ),
      );
      expect(chart.points.map((point) => point.value)).toEqual(
        kind === "rolling" ? [100, 101, 102, 103] : [100, 101, 103],
      );
      expect(chart.window).toEqual({
        start: Date.parse("2026-01-05"),
        end: Date.parse("2026-01-08"),
      });
      expect(chart.session).toBeUndefined();
      expect(chart.regularSession).toBeUndefined();
    },
  );

  it("keeps an ordinary one-day request as a window unless the session view is explicit", () => {
    if (!row.history) throw Error("Missing synthetic history configuration.");
    const oneDay = {
      ...row,
      history: {
        ...row.history,
        window: { kind: "rolling" as const, days: 1 },
      },
    };
    const result = oneDayHistory();
    expect(path(result, oneDay).window).toEqual({
      start: Date.parse("2026-01-06"),
      end: Date.parse("2026-01-07"),
    });
    const chart = path(result, {
      ...oneDay,
      history: { ...oneDay.history, presentation: "session" },
    });
    expect(chart.session).toEqual({
      start: Date.parse("2026-01-06T14:30:00Z"),
      end: Date.parse("2026-01-06T21:00:00Z"),
    });
    expect(chart.window).toBeUndefined();
    expect(chart.label).toContain(
      "Session view: 2026-01-06 (America/New_York), regular trading hours",
    );
  });

  it("narrows only an explicit session presentation and keeps its axis fixed as samples arrive", () => {
    const result = history("minute");
    const chart = path(result, view("session"));
    expect(chart.points.map((point) => point.value)).toEqual([101, 102]);
    expect(chart.session).toEqual({
      start: Date.parse("2026-01-06T14:30:00Z"),
      end: Date.parse("2026-01-06T21:00:00Z"),
    });
    if (!result.series) throw Error("Missing synthetic series.");
    result.series.session = "all";
    const full = path(result, view("session"));
    expect(full.session).toEqual({
      start: Date.parse("2026-01-06T09:00:00Z"),
      end: Date.parse("2026-01-07T01:00:00Z"),
    });
    result.observations = result.observations.slice(0, 3);
    expect(path(result, view("session")).session).toEqual(full.session);
    expect(full.label).toContain("full supplied trading hours");
  });

  it("falls back to the requested window without session evidence or with date-only bars", () => {
    const result = history("minute");
    delete result.price_context;
    const chart = path(result, view("session"));
    expect(chart.points).toHaveLength(4);
    expect(chart.window).toBeDefined();
    expect(chart.session).toBeUndefined();
    const dates = path(dateHistory(), view("session", "sessions"));
    expect(dates.points).toHaveLength(3);
    expect(dates.window).toBeDefined();
    expect(dates.session).toBeUndefined();
    expect(dates.label).toContain("Session dates");
  });

  it("keeps presentation out of source identity and native request arguments", () => {
    const window = view("window"),
      session = view("session");
    expect(
      financialSourceSchema.parse({ feed: "prices", subjects: [session] })
        .subjects[0]?.history?.presentation,
    ).toBe("session");
    expect(
      financialSourceSchema.safeParse({
        feed: "prices",
        subjects: [
          {
            ...session,
            history: { ...session.history, presentation: "guessed" },
          },
        ],
      }).success,
    ).toBe(false);
    for (const operation of ["latest", "history"] as const) {
      expect(financialQueryKey(window, operation)).toEqual(
        financialQueryKey(session, operation),
      );
      expect(financialInput(window, operation, 0)).toEqual(
        financialInput(session, operation, 0),
      );
    }
    const query = (subject: FinancialRow) =>
      financialBinding.queries({
        widget: "instrument-tile",
        source: { feed: "prices", subjects: [subject] },
      })[0];
    expect(query(window)?.resource).toEqual(query(session)?.resource);
  });
});
