import type {
  InstrumentDisplay,
  InstrumentPeriodChange,
  InstrumentStat,
} from "@pythia/widget-sdk";
import { financialQueries } from "./binding";
import type { FinancialRead } from "./contract";
import { financialInstrument } from "./display";
import type { WidgetBinding, WidgetQuery } from "./types";
import {
  CHART_PERIODS,
  chartInputSchema,
  chartPlan,
  quoteSource,
  readQuery,
  seriesQuery,
  type ChartPeriod,
  type ChartResult,
  type PlannedRead,
  type ChartWidgetInput,
  type SeriesList,
} from "./chart-plan";
import type { ReadResult, Series } from "../index";
import { periodPath } from "./chart-path";
import { periodChange, statistics } from "./chart-view";

export {
  CHART_PERIOD_LABELS,
  CHART_PERIODS,
  chartInputSchema,
  chartPlan,
  type ChartPeriod,
  type ChartWidgetInput,
} from "./chart-plan";

export type InstrumentChartData = {
  item: InstrumentDisplay;
  period: ChartPeriod;
  periodChange?: InstrumentPeriodChange | undefined;
  chartMessage?: string | undefined;
  chartLoading: boolean;
  stats: InstrumentStat[];
  statsLoading: boolean;
  quoteLoading: boolean;
  message?: string | undefined;
};

function isRead(value: ChartResult | undefined): value is FinancialRead {
  return Boolean(value && "result" in value);
}

/** The history reads for a period, in a fixed order that render mirrors:
 * the period's bars, the year of daily bars for statistics, then the
 * adjacent periods' bars so switching to them is immediate. */
function plannedReads(
  input: ChartWidgetInput,
  list: Series[],
  quote: ReadResult | undefined,
  now: number,
) {
  const continuous = quote?.price_context?.session?.state === "continuous";
  const plan = chartPlan(list, now, continuous);
  const at = CHART_PERIODS.indexOf(input.period);
  const neighbours = [CHART_PERIODS[at - 1], CHART_PERIODS[at + 1]].flatMap(
    (period) => (period ? [plan.reads.get(period)] : []),
  );
  const queries: WidgetQuery<ChartResult>[] = [];
  const index = (read: PlannedRead | undefined) => {
    if (!read) return -1;
    const query = readQuery(read, now);
    const key = JSON.stringify(query.key);
    const found = queries.findIndex((q) => JSON.stringify(q.key) === key);
    if (found >= 0) return found;
    queries.push(query);
    return queries.length - 1;
  };
  const chart = index(plan.reads.get(input.period));
  const year = index(plan.year);
  for (const read of neighbours) index(read);
  return { plan, queries, chart, year, continuous };
}

/**
 * Page chart binding: a quote and the source's declared series first, then
 * the selected period's bars, a year of daily bars for the statistics and the
 * adjacent periods. The host owns the selected period; this adapter owns its
 * financial meaning.
 */
export const chartBinding: WidgetBinding<
  ChartWidgetInput,
  ChartResult,
  InstrumentChartData
> = {
  queries(input) {
    const parsed = chartInputSchema.parse(input);
    const quote = financialQueries(quoteSource(parsed), "latest")[0];
    if (!quote) throw Error("No quote request is configured.");
    return [quote as WidgetQuery<ChartResult>, seriesQuery(parsed)];
  },
  deferred(input, [quote, list]) {
    const series = (list?.data as SeriesList | undefined)?.series;
    // The market's session kind chooses the windows, so wait for the quote;
    // a failed quote read still lets the chart load.
    const read = isRead(quote?.data) ? quote.data.result : undefined;
    if (!series || (!read && !quote?.error)) return [];
    return plannedReads(input, series, read, Date.now()).queries;
  },
  render(input, [quoteQuery, listQuery], deferred, { formatTimestamp }) {
    const quoteRead = isRead(quoteQuery?.data)
      ? quoteQuery.data.result
      : undefined;
    const series = (listQuery?.data as SeriesList | undefined)?.series;
    const planned =
      series && (quoteRead || quoteQuery?.error)
        ? plannedReads(input, series, quoteRead, Date.now())
        : undefined;
    const plan = planned?.plan;
    const chartQuery = planned ? deferred[planned.chart] : undefined;
    const yearQuery = planned ? deferred[planned.year] : undefined;
    const chartRead = isRead(chartQuery?.data)
      ? chartQuery.data.result
      : undefined;
    const yearRead = isRead(yearQuery?.data)
      ? yearQuery.data.result
      : undefined;
    const item = financialInstrument(
      {
        subject: input.subject,
        symbol: input.symbol,
        name: input.name,
        price: { mode: "preferred", criteria: {} },
      },
      quoteRead,
      undefined,
      false,
      formatTimestamp,
    );
    const continuous = planned?.continuous ?? false;
    const drawn = chartRead
      ? periodPath(input.period, chartRead, quoteRead, continuous)
      : {};
    delete item.pathState;
    const failed = (query: typeof quoteQuery) =>
      Boolean(query?.error) ||
      (isRead(query?.data) && query.data.result.outcome === "error");
    const chartMessage =
      plan?.unavailable.get(input.period) ??
      (listQuery?.error
        ? "The source's price series could not be listed."
        : undefined) ??
      (failed(chartQuery) ? "This chart could not be loaded." : undefined) ??
      drawn.message;
    const quoteLoading = quoteQuery?.isPending ?? true;
    return {
      state: quoteLoading && !quoteQuery?.data ? "loading" : "ready",
      ...(failed(quoteQuery)
        ? { message: "The price could not be loaded." }
        : {}),
      data: {
        item: {
          ...item,
          ...(drawn.path
            ? { path: drawn.path }
            : { pathState: chartMessage ? "unavailable" : "loading" }),
        },
        period: input.period,
        periodChange: periodChange(input.period, drawn.path),
        chartMessage,
        chartLoading: !chartMessage && !drawn.path,
        stats: statistics(quoteRead, yearRead, (plan?.year?.days ?? 0) >= 365),
        statsLoading: Boolean(plan?.year && yearQuery?.isPending),
        quoteLoading,
      },
    };
  },
};
