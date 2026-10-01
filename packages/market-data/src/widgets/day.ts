import type { InstrumentDisplay } from "@pythia/widget-sdk";
import type { ReadInput, ReadResult } from "../index";
import { periodPath } from "./chart-path";
import {
  type ChartWidgetInput,
  chartPlan,
  PLUGIN,
  quoteSource,
  readQuery,
  type SeriesList,
  seriesQuery,
} from "./chart-plan";
import {
  type FinancialRead,
  financialInput,
  readResultSchema,
} from "./contract";
import { financialInstrument } from "./display";
import type { WidgetBinding, WidgetQuery, WidgetQueryResult } from "./types";

/** One instrument by its explicit source address (a page section's binding). */
export type DayRow = Omit<ChartWidgetInput, "period">;
export type DayInput = { rows: readonly DayRow[] };
/** Each row's display with today's path. */
export type DayData = {
  rows: InstrumentDisplay[];
  /** Rows whose quote read has not answered yet. */
  pending: boolean[];
  /** Rows whose quote or chart read failed; their retained values are stale. */
  failed: boolean[];
  state: "loading" | "ready" | "empty" | "error";
  message?: string | undefined;
};
/** The quotes' results in the rows' order, a source's declared series, or
 * one row's bars. */
type DayResult = { results: ReadResult[] } | SeriesList | FinancialRead;

/** One coordinated resource reading every row's quote together. */
function batch(
  key: unknown[],
  inputs: ReadInput[],
  fresh: () => ReadInput[],
): WidgetQuery<DayResult> {
  const resource = (reads: ReadInput[]) => ({
    plugin: PLUGIN,
    operation: "query",
    arguments: { action: "read_many", reads },
  });
  return {
    key,
    resource: resource(inputs),
    enabled: true,
    readResource: () => resource(fresh()),
    decode(value) {
      const raw = value as { outcome?: string; data?: unknown[] };
      if (raw.outcome !== "ok" || raw.data?.length !== inputs.length)
        throw Error("Invalid financial response.");
      return { results: raw.data.map((item) => readResultSchema.parse(item)) };
    },
  };
}

function results(query: WidgetQueryResult<DayResult> | undefined) {
  const data = query?.data;
  return data && "results" in data ? data.results : undefined;
}

/** Each row's 1D bars as the page chart plans them (the same reads and keys,
 * so an instrument page opened from here starts cached), once every quote and
 * declared series has answered: they then join the update channel together,
 * which serves reads arriving together as one batch. */
function histories(input: DayInput, primary: WidgetQueryResult<DayResult>[]) {
  if (primary.some((query) => query?.isPending)) return undefined;
  const quotes = results(primary[0]);
  const now = Date.now();
  const rows = input.rows.map((_row, index) => {
    const series = (primary[index + 1]?.data as SeriesList | undefined)?.series;
    if (!series) return { unavailable: true, continuous: false };
    const continuous =
      quotes?.[index]?.price_context?.session?.state === "continuous";
    const read = chartPlan(series, now, continuous).reads.get("1D");
    return {
      query: read && (readQuery(read, now) as WidgetQuery<DayResult>),
      continuous,
      unavailable: !read,
    };
  });
  return {
    rows,
    queries: rows.flatMap((row) => (row.query ? [row.query] : [])),
  };
}

/**
 * Quotes with today's path for a list of instruments, as the markets overview
 * shows them: one read for every quote, each source's declared series, then
 * the instrument page chart's 1D bars for every row.
 */
export const dayBinding: WidgetBinding<DayInput, DayResult, DayData> = {
  queries(input) {
    if (!input.rows.length) return [];
    const subjects = input.rows.map(
      (row) => quoteSource({ ...row, period: "1D" }).subjects[0],
    );
    const inputs = (now: number) =>
      subjects.flatMap((row) => {
        const read = row && financialInput(row, "latest", now);
        return read ? [read] : [];
      });
    return [
      batch(
        ["financial-day-quotes", input.rows.map((row) => row.subject)],
        inputs(0),
        () => inputs(Date.now()),
      ),
      ...input.rows.map(
        (row) =>
          seriesQuery({ ...row, period: "1D" }) as WidgetQuery<DayResult>,
      ),
    ];
  },
  deferred(input, primary) {
    return histories(input, primary)?.queries ?? [];
  },
  render(input, primary, deferred, { formatTimestamp }) {
    const quoteQuery = primary[0];
    const quotes = results(quoteQuery);
    const planned = histories(input, primary);
    const charts = new Map<number, WidgetQueryResult<DayResult> | undefined>();
    let next = 0;
    planned?.rows.forEach((row, index) => {
      if (row.query) charts.set(index, deferred[next++]);
    });
    const pending: boolean[] = [];
    const failed: boolean[] = [];
    let failedPrices = false;
    let failedCharts = false;
    const rows = input.rows.map((row, index): InstrumentDisplay => {
      const quote = quotes?.[index];
      pending.push(Boolean(quoteQuery?.isPending));
      if (quoteQuery?.isPending) {
        failed.push(false);
        // Known identity, no values yet: never a failure while the read runs.
        return {
          id: String(index),
          ticker: row.symbol,
          name: row.name,
          price: null,
          status: "unknown",
          statusLabel: "Loading quote",
          description: "Loading quote",
          pathState: "loading",
        };
      }
      const item = financialInstrument(
        { ...row, price: { mode: "preferred", criteria: {} } },
        quote,
        undefined,
        false,
        formatTimestamp,
      );
      delete item.pathState;
      const plan = planned?.rows[index];
      const query = charts.get(index);
      const chart = (query?.data as FinancialRead | undefined)?.result;
      const drawn = chart
        ? periodPath(
            "1D",
            chart,
            quote,
            plan?.continuous ?? false,
            Date.now(),
            true,
          )
        : {};
      const priceFailed =
        Boolean(quoteQuery?.error) || quote?.outcome === "error";
      const chartFailed = Boolean(query?.error) || chart?.outcome === "error";
      failedPrices ||= priceFailed;
      failedCharts ||= chartFailed;
      failed.push(priceFailed || chartFailed);
      const shown: InstrumentDisplay = drawn.path
        ? { ...item, path: drawn.path }
        : {
            ...item,
            pathState:
              plan?.unavailable ||
              chartFailed ||
              drawn.message ||
              quoteQuery?.error
                ? "unavailable"
                : "loading",
          };
      // A retained value whose updates failed stays, marked stale.
      if (
        shown.activity?.data !== "unavailable" &&
        ((quoteQuery?.error && quote) || (query?.error && chart))
      ) {
        shown.activity = {
          ...shown.activity,
          session: shown.activity?.session ?? "unknown",
          data: "stale",
        };
        shown.statusLabel = "Updates unavailable · last received value";
        if (query?.error && shown.path)
          shown.path = {
            ...shown.path,
            label: `${shown.path.label} · Chart updates unavailable`,
          };
      }
      return shown;
    });
    const loading = rows.length > 0 && Boolean(quoteQuery?.isPending);
    const state = !rows.length ? "empty" : loading ? "loading" : "ready";
    const message =
      failedPrices || failedCharts
        ? `${failedPrices ? "Some prices could not be loaded. " : ""}${failedCharts ? "Some charts could not be loaded. " : ""}Any retained values are marked as stale.`
        : undefined;
    return {
      state,
      ...(message ? { message } : {}),
      data: { rows, pending, failed, state, ...(message ? { message } : {}) },
    };
  },
};
