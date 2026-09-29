"use client";
import type { MarketOverview } from "@pythia/market-data/markets";
import { Button, cn } from "@pythia/ui";
import type { ReactNode } from "react";
import { useMarketOverview } from "@/client/market-queries";
import {
  type ReferenceStatus,
  useReferenceStatus,
} from "@/client/reference-status";
import { MarketCard, type SubjectDay, useSubjectDays } from "./market-card";
import {
  Block,
  MoversCaption,
  MoversTable,
  WatchlistTable,
} from "./market-tables";

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

/** Why subjects cannot be read when the device has no usable reference
 * data (none installed, an incompatible one, or a refused package), and what
 * to do; undefined while unknown or when compatible data is installed. */
export function referenceNote(status: ReferenceStatus | null | undefined) {
  if (status === undefined || status?.installed?.compatible) return undefined;
  const install =
    "Install a reference package this Pythia reads (just reference-install <package>; Settings › Reference data shows what is installed), then Retry.";
  const cause = status?.installed
    ? `The installed reference package ${status.installed.build_id} is not compatible with this Pythia`
    : status?.refused
      ? `A reference package was refused (${status.refused.message})`
      : "Reference data is not installed on this device yet";
  return `${cause}, so some subjects cannot be shown. ${install}`;
}

/** A card's read failure, as the September blocks showed it: what failed,
 * that retained values are marked stale, and Retry. A subject that could not
 * be read without reference data says what to do instead. */
export function ReadFailure({
  days,
  message,
  reference,
  retry,
}: {
  days: SubjectDay[];
  message: string | undefined;
  reference: string | undefined;
  retry: () => void;
}) {
  if (!days.some((day) => day.failed)) return null;
  const unread = days.some((day) => day.failed && !day.known);
  return (
    <>
      <p role="alert" className="mt-2 max-w-prose text-error text-xs">
        {(unread && reference) || message || "Some subjects could not be read."}
      </p>
      <Button className="mt-2" size="sm" variant="ghost" onClick={retry}>
        Retry
      </Button>
    </>
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
        <Block
          key={group}
          title={group}
          // Provenance beside the values (docs/design.md): the sources core chose for this group's cards.
          meta={[...new Set(members.flatMap((day) => day.source ?? []))].join(
            " · ",
          )}
        >
          <div className="@min-[520px]:flex grid grid-cols-2 @min-[520px]:flex-wrap items-start gap-2">
            {members.map((day) => (
              <MarketCard key={day.subject} day={day} />
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
  const { days, message, retry } = useSubjectDays(
    [...cards.map((card) => card.subject), ...(data?.watchlist ?? [])],
    data?.names ?? {},
  );
  const referenceStatus = useReferenceStatus();
  const reference = referenceNote(
    referenceStatus.data ? (referenceStatus.data.data ?? null) : undefined,
  );
  const retryAll = () => {
    retry();
    void referenceStatus.refetch();
  };
  const cardDays = days.slice(0, cards.length);
  const watchDays = days.slice(cards.length);
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
        <Card title="Global markets" wide>
          {overview.isPending ? (
            <p role="status" className="py-3 text-foreground-secondary text-xs">
              Opening your markets…
            </p>
          ) : cards.length ? (
            <>
              <MarketGroups cards={cards} days={cardDays} />
              <ReadFailure
                days={cardDays}
                message={message}
                reference={reference}
                retry={retryAll}
              />
            </>
          ) : data ? (
            <p className="py-3 text-foreground-secondary text-xs">
              No markets to show. Add subject IDs to markets_cards in
              settings.json.
            </p>
          ) : null}
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
            <WatchlistTable days={watchDays} />
            <ReadFailure
              days={watchDays}
              message={message}
              reference={reference}
              retry={retryAll}
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
