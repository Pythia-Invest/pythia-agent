import {
  InstrumentChart,
  InstrumentQuoteHeader,
  InstrumentStats,
  type WidgetProps,
} from "@pythia/widget-sdk";
import type { InstrumentChartData } from "@pythia/market-data/widgets";

export { chartBinding as binding } from "@pythia/market-data/widgets";

/** `instrument-chart`: an instrument page's price section. The host selects
 * the period; quote, chart and statistics keep their own sources and states. */
export default function InstrumentPriceChart({
  data,
}: WidgetProps<InstrumentChartData>) {
  const { item } = data;
  return (
    <div data-slot="market-data-chart" className="flex min-w-0 flex-col gap-4">
      <InstrumentQuoteHeader
        item={item}
        loading={data.quoteLoading && item.price === null}
        periodChange={data.periodChange}
      />
      <InstrumentChart
        item={item}
        height={260}
        loading={data.chartLoading}
        emptyLabel={data.chartMessage}
      />
      {data.message ? (
        <p role="status" className="text-error text-xs">
          {data.message}
        </p>
      ) : null}
      {data.stats.length || data.statsLoading ? (
        <InstrumentStats
          stats={data.stats}
          precision={item.precision}
          loading={data.statsLoading && !data.stats.length}
          className="border-border/60 border-t pt-3"
        />
      ) : null}
    </div>
  );
}
