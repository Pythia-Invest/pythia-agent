import type { InstrumentDisplay } from "@pythia/widget-sdk";
import type { ReadResult } from "../index";
import { financialQueries } from "./binding";
import { periodPath } from "./chart-path";
import {
  type ChartResult,
  type ChartWidgetInput,
  chartPlan,
  quoteSource,
  readQuery,
  type SeriesList,
  seriesQuery,
} from "./chart-plan";
import type { FinancialRead } from "./contract";
import { financialInstrument } from "./display";
import type { WidgetBinding, WidgetQuery, WidgetQueryResult } from "./types";

/** One instrument by its explicit source address (a page section's binding). */
export type DayRow = Omit<ChartWidgetInput, "period">;
export type DayInput = { rows: readonly DayRow[] };
/** Each row's display with today's path, and the time of its quote. */
export type DayData = {
  rows: InstrumentDisplay[];
  times: (string | null)[];
  state: "loading" | "ready" | "empty" | "error";
  message?: string | undefined;
};

function isRead(value: ChartResult | undefined): value is FinancialRead {
  return Boolean(value && "result" in value);
}

/** Each row's 1D bars as the page chart plans them, once its quote and
 * declared series are known; undefined while waiting. */
function plans(
  input: DayInput,
  primary: WidgetQueryResult<ChartResult>[],
  now: number,
) {
  return input.rows.map((_row, index) => {
    const quote = primary[2 * index];
    const series = (primary[2 * index + 1]?.data as SeriesList | undefined)
      ?.series;
    const read = isRead(quote?.data) ? quote.data.result : undefined;
    if (!series || (!read && !quote?.error)) return undefined;
    const continuous = read?.price_context?.session?.state === "continuous";
    const plan = chartPlan(series, now, continuous);
    return {
      read: plan.reads.get("1D"),
      unavailable: plan.unavailable.get("1D"),
      continuous,
    };
  });
}

function quoteTime(read: ReadResult | undefined) {
  const time = read?.observations.at(-1)?.time;
  return time && time.kind !== "unknown" ? time.value : null;
}

/**
 * Quotes with today's path for a list of instruments, as the markets overview
 * shows them. Per row: the quote and the source's declared series, then the
 * same 1D bars and query keys as the instrument page's chart, so a page opened
 * from here starts from cached reads.
 */
export const dayBinding: WidgetBinding<DayInput, ChartResult, DayData> = {
  queries(input) {
    return input.rows.flatMap((row) => {
      const parsed = { ...row, period: "1D" as const };
      return [
        financialQueries(
          quoteSource(parsed),
          "latest",
        )[0] as WidgetQuery<ChartResult>,
        seriesQuery(parsed),
      ];
    });
  },
  deferred(input, primary) {
    return plans(input, primary, Date.now()).flatMap((plan) =>
      plan?.read ? [readQuery(plan.read, Date.now())] : [],
    );
  },
  render(input, primary, deferred, { formatTimestamp }) {
    const planned = plans(input, primary, Date.now());
    let next = 0;
    const times: (string | null)[] = [];
    const rows = input.rows.map((row, index) => {
      const quoteQuery = primary[2 * index];
      const quote = isRead(quoteQuery?.data)
        ? quoteQuery.data.result
        : undefined;
      const plan = planned[index];
      const chartQuery = plan?.read ? deferred[next++] : undefined;
      const chart = isRead(chartQuery?.data)
        ? chartQuery.data.result
        : undefined;
      const item = financialInstrument(
        { ...row, price: { mode: "preferred", criteria: {} } },
        quote,
        undefined,
        false,
        formatTimestamp,
      );
      delete item.pathState;
      times.push(quoteTime(quote));
      const drawn = chart
        ? periodPath("1D", chart, quote, plan?.continuous ?? false)
        : {};
      const settled =
        plan !== undefined &&
        (!plan.read ||
          Boolean(chartQuery?.error) ||
          chart?.outcome === "error" ||
          Boolean(drawn.message));
      return drawn.path
        ? { ...item, path: drawn.path }
        : {
            ...item,
            pathState:
              settled || quoteQuery?.error
                ? ("unavailable" as const)
                : ("loading" as const),
          };
    });
    const loading =
      rows.length > 0 &&
      input.rows.every((_row, index) => primary[2 * index]?.isPending);
    const failed = input.rows.some((_row, index) => {
      const quote = primary[2 * index];
      return (
        Boolean(quote?.error) ||
        (isRead(quote?.data) && quote.data.result.outcome === "error")
      );
    });
    const state = !rows.length ? "empty" : loading ? "loading" : "ready";
    const message = failed ? "Some prices could not be loaded." : undefined;
    return {
      state,
      ...(message ? { message } : {}),
      data: { rows, times, state, ...(message ? { message } : {}) },
    };
  },
};
