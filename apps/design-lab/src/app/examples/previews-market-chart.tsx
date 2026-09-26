"use client";
import { useState } from "react";
import {
  InstrumentChart,
  InstrumentPeriodSelector,
  InstrumentQuoteHeader,
  InstrumentStats,
  type InstrumentDisplay,
} from "@pythia/ui";
import { chartExamples, chartStats } from "./market-chart-fixtures";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

const periods = [
  { id: "1D", label: "1D", item: chartExamples.euDay },
  { id: "5D", label: "5D", item: chartExamples.fiveCalendar },
  { id: "1Y", label: "1Y", item: chartExamples.year },
  {
    id: "5Y",
    label: "5Y",
    item: chartExamples.loading,
    unavailable:
      "The synthetic source provides at most one year of daily bars.",
  },
] as const;

function PriceSection({
  item,
  children,
}: {
  item: InstrumentDisplay;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      {children}
      <InstrumentQuoteHeader item={item} />
      <InstrumentChart item={item} height={260} />
    </div>
  );
}

/** Page-scale price section on synthetic sessions. */
export function MarketChartPreview() {
  const [period, setPeriod] = useState<string>("1D");
  const selected = periods.find((p) => p.id === period) ?? periods[0];
  return (
    <SpecimenGrid>
      <div className="col-span-full">
        <Specimen label="Price section · period selector, header, chart and statistics">
          <div className="flex w-full max-w-3xl flex-col gap-4">
            <InstrumentPeriodSelector
              periods={periods}
              value={period}
              onValueChange={setPeriod}
              className="self-end"
            />
            <InstrumentQuoteHeader
              item={selected.item}
              periodChange={
                period === "1D"
                  ? undefined
                  : {
                      absolute: 3.1,
                      percent: 3.14,
                      label: period === "5D" ? "Past 5 days" : "Past year",
                      basis: "Synthetic first close in this period",
                    }
              }
            />
            <InstrumentChart item={selected.item} height={260} />
            <InstrumentStats
              stats={chartStats}
              precision={2}
              className="border-border/60 border-t pt-3"
            />
          </div>
        </Specimen>
      </div>
      <div className="col-span-full">
        <Specimen label="1D · US session with pre-market and after-hours, market open">
          <PriceSection item={chartExamples.usOpen} />
        </Specimen>
      </div>
      <div className="col-span-full">
        <Specimen label="1D · after-hours trading, extended quote retained">
          <PriceSection item={chartExamples.usPost} />
        </Specimen>
      </div>
      <div className="col-span-full">
        <Specimen label="1D · pre-market: prior regular session, omitted night, today's pre-market">
          <PriceSection item={chartExamples.usPre} />
        </Specimen>
      </div>
      <div className="col-span-full">
        <Specimen label="5D comparison · A: calendar time (current market-widget rule)">
          <PriceSection item={chartExamples.fiveCalendar} />
          <DemoNote>
            Nights and the weekend keep their elapsed width; the product uses
            this variant.
          </DemoNote>
        </Specimen>
      </div>
      <div className="col-span-full">
        <Specimen label="5D comparison · B: session-compressed (omitted closed hours)">
          <PriceSection item={chartExamples.fiveCompressed} />
          <DemoNote>
            Closed intervals are omitted and marked; timestamps are unchanged.
            Shown for comparison only, not adopted.
          </DemoNote>
        </Specimen>
      </div>
      <Specimen label="Loading · history pending, quote ready">
        <PriceSection item={chartExamples.loading} />
      </Specimen>
      <Specimen label="Period beyond the source's history">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <InstrumentChart
            item={{ ...chartExamples.loading, pathState: "unavailable" }}
            emptyLabel="The source provides at most 90 days of daily history."
          />
        </div>
      </Specimen>
    </SpecimenGrid>
  );
}
