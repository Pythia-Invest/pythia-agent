"use client";
import type { MarketOverview } from "@pythia/market-data/markets";
import { Button, cn } from "@pythia/ui";
import type { ReactNode } from "react";
import { useMarketOverview } from "@/client/market-queries";
import { DayCard, type SubjectDay, useSubjectDays } from "./market-card";
import { MoversCaption, MoversTable, WatchlistTable } from "./market-tables";

/** One titled card of the overview (the Markets page design of September:
 * a headed card, its blocks titled in small secondary type). */
function Card({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      data-slot="markets-card"
      aria-label={title}
      className={cn("@container min-w-0", wide && "@min-[680px]:col-span-2")}
    >
      <header className="mb-3 border-border/50 border-b pb-2">
        <h2 className="font-semibold text-base tracking-tight">{title}</h2>
      </header>
      {children}
    </section>
  );
}

export function Block({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <h3 className="mb-2.5 flex items-baseline justify-between gap-2 font-medium text-[11px] text-foreground-secondary">
        {title}
        {meta ? (
          <span className="min-w-0 truncate font-normal text-[10px]">
            {meta}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

/** The cards in their groups, groups in the order the investor listed them. */
function MarketGroups({
  cards,
  days,
}: {
  cards: MarketOverview["cards"];
  days: SubjectDay[];
}) {
  const found = new Map<string, SubjectDay[]>();
  cards.forEach((card, index) => {
    const day = days[index];
    if (day) found.set(card.group, [...(found.get(card.group) ?? []), day]);
  });
  return (
    <div className="flex @min-[520px]:flex-row flex-col @min-[520px]:flex-wrap gap-x-6 gap-y-4">
      {[...found].map(([group, members]) => (
        <Block key={group} title={group}>
          <div className="flex flex-wrap items-start gap-2">
            {members.map((day) => (
              <DayCard key={day.subject} day={day} />
            ))}
          </div>
        </Block>
      ))}
    </div>
  );
}

/**
 * The markets overview: a card per configured market (indexes, futures, a
 * rate, FX, commodities, crypto) grouped by region and asset class, today's
 * US movers and the watchlist. The subjects come from settings.json
 * (`markets_cards`, `markets_watchlist`) or Pythia's defaults; each price
 * comes from the source core chooses for the instrument page.
 */
export function MarketsOverview() {
  const overview = useMarketOverview();
  const data = overview.data?.overview;
  const cards = data?.cards ?? [];
  // Cards and watchlist share one read, so their quotes and paths reach the
  // update channel together.
  const days = useSubjectDays([
    ...cards.map((card) => card.subject),
    ...(data?.watchlist ?? []),
  ]);
  return (
    <div
      data-slot="markets-overview"
      className="@container mx-auto w-full max-w-7xl @min-[640px]:px-5 px-3 pt-4.5 pb-4"
    >
      {overview.error ? (
        <div role="alert" className="mb-3 flex flex-col items-start gap-2">
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
        <p
          key={issue.message}
          role="status"
          className="mb-3 text-warning text-xs"
        >
          {issue.message}
        </p>
      ))}
      <div className="grid @min-[680px]:grid-cols-2 grid-cols-1 items-start gap-x-3 gap-y-6">
        <Card title="Markets" wide>
          {overview.isPending ? (
            <p role="status" className="py-3 text-foreground-secondary text-xs">
              Opening your markets…
            </p>
          ) : (
            <MarketGroups cards={cards} days={days} />
          )}
        </Card>
        <Card title="Market movers" wide>
          <MoversCaption />
          <div className="grid @min-[680px]:grid-cols-3 grid-cols-1 gap-4">
            <MoversTable list="most_active" title="Most active" />
            <MoversTable list="gainers" title="Top gainers" />
            <MoversTable list="losers" title="Top losers" />
          </div>
        </Card>
        {data ? (
          <Card title="Watchlist">
            <WatchlistTable days={days.slice(cards.length)} />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
