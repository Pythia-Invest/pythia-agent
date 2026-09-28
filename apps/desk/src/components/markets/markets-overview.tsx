"use client";
import { Button } from "@pythia/ui";
import type { ReactNode } from "react";
import { useMarketOverview } from "@/client/market-queries";
import { MarketCard } from "./market-card";
import { MoversTable, WatchlistTable } from "./market-tables";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <header className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-semibold text-body text-foreground">{title}</h2>
        <p className="text-foreground-secondary text-xs">{description}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * The markets overview: a card per configured market (indexes, futures, a
 * rate, FX, crypto), today's movers and the watchlist. The subjects come from
 * settings.json (`markets_cards`, `markets_watchlist`) or Pythia's defaults;
 * each price comes from the source core chooses for the instrument page.
 */
export function MarketsOverview() {
  const overview = useMarketOverview();
  const data = overview.data?.overview;
  return (
    <div
      data-slot="markets-overview"
      className="@container mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 min-[600px]:px-6"
    >
      {overview.error ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-body text-foreground">
            The markets overview could not be opened.
          </p>
          <p className="text-foreground-secondary text-xs">
            {overview.error.message}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void overview.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {overview.data?.issues.map((issue) => (
        <p key={issue.message} role="status" className="text-warning text-xs">
          {issue.message}
        </p>
      ))}
      <Section
        title="Markets"
        description="Indexes, futures, rates, currencies and crypto"
      >
        <div className="grid @min-[1100px]:grid-cols-6 @min-[520px]:grid-cols-3 @min-[820px]:grid-cols-4 grid-cols-2 gap-2">
          {(data?.cards ?? []).map((subject) => (
            <MarketCard key={subject} subject={subject} />
          ))}
        </div>
      </Section>
      <Section
        title="Movers"
        description="Today's most traded shares and largest moves"
      >
        <div className="grid @min-[820px]:grid-cols-3 grid-cols-1 gap-4">
          <MoversTable list="most_active" title="Most active" />
          <MoversTable list="gainers" title="Top gainers" />
          <MoversTable list="losers" title="Top losers" />
        </div>
      </Section>
      {data ? (
        <Section
          title="Watchlist"
          description="Your subjects, set in markets_watchlist"
        >
          <div className="max-w-xl">
            <WatchlistTable subjects={data.watchlist} />
          </div>
        </Section>
      ) : null}
    </div>
  );
}
