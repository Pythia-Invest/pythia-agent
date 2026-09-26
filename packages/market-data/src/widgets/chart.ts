import type {
  InstrumentDisplay,
  InstrumentPeriodChange,
  InstrumentPeriodOption,
  InstrumentStat,
} from "@pythia/widget-sdk";
import { financialQueries } from "./binding";
import type { FinancialRead } from "./contract";
import { financialInstrument } from "./display";
import type { WidgetBinding, WidgetQuery } from "./types";
import {
  CHART_PERIOD_LABELS,
  CHART_PERIODS,
  chartInputSchema,
  chartPlan,
  quoteSource,
  readQuery,
  seriesQuery,
  type ChartPeriod,
  type ChartResult,
  type ChartWidgetInput,
  type SeriesList,
} from "./chart-plan";
import { periodChange, periodPath, statistics } from "./chart-view";

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
  periods: InstrumentPeriodOption[];
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

/**
 * Page chart binding: a quote and the source's declared series first, then
 * the selected period's bars and one year of daily bars for the statistics.
 * The host owns the selected period; this adapter owns its financial meaning.
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
  deferred(input, [, list]) {
    const series = (list?.data as SeriesList | undefined)?.series;
    if (!series) return [];
    const now = Date.now();
    const plan = chartPlan(series, now);
    const selected = plan.reads.get(input.period);
    const reads = [selected, plan.year].map((read) =>
      read ? readQuery(read, now) : undefined,
    );
    // One query when the period is served by the year of daily bars.
    const [chart, year] = reads;
    return [
      ...(chart ? [chart] : []),
      ...(year && JSON.stringify(year.key) !== JSON.stringify(chart?.key)
        ? [year]
        : []),
    ];
  },
  render(input, [quoteQuery, listQuery], deferred, { formatTimestamp }) {
    const quoteRead = isRead(quoteQuery?.data)
      ? quoteQuery.data.result
      : undefined;
    const series = (listQuery?.data as SeriesList | undefined)?.series;
    const plan = series ? chartPlan(series, Date.now()) : undefined;
    const selected = plan?.reads.get(input.period);
    const chartQuery = selected ? deferred[0] : undefined;
    // Mirrors deferred(): the chart read first, then the year unless shared.
    const shared = selected === plan?.year;
    const yearQuery = !plan?.year
      ? undefined
      : shared || !selected
        ? deferred[0]
        : deferred[1];
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
    const continuous =
      quoteRead?.price_context?.session?.state === "continuous";
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
        periods: CHART_PERIODS.map((id) => ({
          id,
          label: CHART_PERIOD_LABELS[id],
          ...(plan?.unavailable.get(id)
            ? { unavailable: plan.unavailable.get(id) }
            : {}),
        })),
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
