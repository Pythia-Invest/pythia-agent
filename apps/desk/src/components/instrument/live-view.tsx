"use client";
import { type LiveMarket, parseLiveMarket } from "@pythia/market-data/live";
import type { SubjectSection } from "@pythia/market-data/subject";
import {
  InstrumentChart,
  type InstrumentDisplay,
  InstrumentQuoteHeader,
  type InstrumentStat,
  InstrumentStats,
  OrderBookLadder,
  type TradeDisplay,
  TradeTape,
  cn,
} from "@pythia/ui";
import { useEffect, useState } from "react";
import { DeskApiError } from "@/client/api";
import { useDataQueries } from "@/client/data-queries";
import { SectionFailure, SectionLoading } from "./section-status";

const WINDOW_MS = 15 * 60_000;
/** Without a snapshot for this long the view stops looking live; a live book
 * updates about twice a second. Receipt time, so clock skew cannot fake it. */
const QUIET_MS = 5_000;
const REFUSED: Record<string, string> = {
  unknown_market: "The source does not list this market.",
  delisted: "This market is delisted at the source.",
  source_drift:
    "The source's market list arrived in an unexpected shape, so the live view stays off. It is checked again in a few minutes.",
};
const MEASURES = {
  last_trade: "Last trade",
  mid: "Mid price",
  mark: "Mark price",
} as const;

function useClock(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

const number = (value: string | undefined) =>
  value === undefined ? null : Number(value);
const clock = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, { hourCycle: "h23" });

/** Price decimals from the source's own prices, trailing zeros ignored. */
function pricePrecision(market: LiveMarket) {
  const prices = [
    ...(market.book?.bids ?? []).map((level) => level[0]),
    ...(market.book?.asks ?? []).map((level) => level[0]),
    ...(market.context?.kind === "perp" && market.context.mark
      ? [market.context.mark]
      : []),
  ];
  return Math.min(
    8,
    Math.max(
      0,
      ...prices.map(
        (price) => (price.split(".")[1] ?? "").replace(/0+$/, "").length,
      ),
    ),
  );
}

/** A `live_market` section: subscribed through the shared update channel only
 * while it is on screen; the channel pauses with the tab. */
export function LiveMarketView({ section }: { section: SubjectSection }) {
  const request = section.request;
  const [query] = useDataQueries(
    request
      ? [
          {
            key: ["plugin", request.plugin, "live", request],
            resource: request,
            enabled: true,
            decode: parseLiveMarket,
          },
        ]
      : [],
  );
  const now = useClock(1000);
  if (!request || !query)
    return <SectionFailure message="This section has no live read." />;
  const market = query.data;
  if (!market) {
    if (query.isError) {
      const code =
        query.error instanceof DeskApiError ? query.error.code : undefined;
      return (
        <SectionFailure
          message={
            (code && REFUSED[code]) ??
            `${section.label}: ${query.error?.message ?? "no data"}`
          }
        />
      );
    }
    return (
      <SectionLoading label={`Connecting to ${section.label}…`} lines={6} />
    );
  }
  const stale =
    Boolean(query.error) ||
    market.issues.some((issue) => issue.code === "reconnecting") ||
    now - query.dataUpdatedAt > QUIET_MS;
  return (
    <LiveMarketPanel
      market={market}
      label={section.label}
      stale={stale}
      now={now}
    />
  );
}

export function LiveMarketPanel({
  market,
  label,
  stale,
  now,
}: {
  market: LiveMarket;
  label: string;
  stale: boolean;
  now: number;
}) {
  const precision = pricePrecision(market);
  const unit = market.book?.unit.code;
  const context = market.context;
  const perp = context?.kind === "perp" ? context : undefined;
  const session = context?.kind === "equity_session" ? context : undefined;
  const trades = market.trades?.items ?? [];
  const last = trades.at(-1);
  const mark = number(perp?.mark);
  const price = mark ?? number(last?.[1]);
  const previous = number(perp?.prev_day);
  const venueOnly =
    market.source.scope === "venue" &&
    !market.subject.subject_id.startsWith("market:");
  const provenance = `${label}${venueOnly ? ` (${market.source.venue} only)` : ""}, real time. Last update ${clock(market.retrieved_at)}.`;
  const header: InstrumentDisplay = {
    id: `${market.subject.subject_id}:live`,
    ticker: unit ?? market.source.venue,
    priceLabel: mark !== null ? "Mark price" : "Last trade",
    price,
    precision,
    status: "live",
    activity: {
      session:
        session?.venue_status === "halted"
          ? "halted"
          : session?.session === "regular"
            ? "open"
            : (session?.session ?? "continuous"),
      data: stale ? "stale" : "current",
    },
    statusLabel: stale ? "Updates paused" : "Real time",
    description: provenance,
    ...(price !== null && previous
      ? {
          change: {
            absolute: price - previous,
            percent: ((price - previous) / previous) * 100,
            basis: "24h",
          },
        }
      : session?.change
        ? {
            change: {
              absolute: Number(session.change.absolute),
              percent: Number(session.change.percent),
              basis: "vs reference close",
            },
          }
        : {}),
  };
  const points = (market.line?.points ?? []).map(([time, value]) => ({
    time,
    value: Number(value),
  }));
  const end = Math.max(now, points.at(-1)?.time ?? 0);
  const shown = points.filter((point) => point.time >= end - WINDOW_MS);
  const chart: InstrumentDisplay = {
    ...header,
    ...(shown.length
      ? {
          path: {
            live: !stale,
            points: shown,
            window: { start: end - WINDOW_MS, end },
            // A minute without trades breaks the line; seeded minutes join.
            intervalMs: 60_000,
            label: `${MEASURES[market.line?.measure ?? "last_trade"]}, past 15 minutes${market.line?.seeded_from ? " (earlier minutes from 1-minute candles)" : ""}`,
          },
        }
      : {}),
  };
  const funding = perp?.funding;
  const next = funding?.next_time;
  const stats: InstrumentStat[] = [
    ...(perp
      ? [
          {
            id: "oracle",
            label: "Oracle",
            value: number(perp.oracle),
            detail:
              "The source's oracle price, a weighted median of exchange spot prices.",
          },
          {
            id: "mid",
            label: "Mid",
            value: number(perp.mid),
            detail: "Midpoint of the best bid and ask.",
          },
          {
            id: "funding",
            label: "Funding · 1h",
            value: funding ? Number(funding.rate_1h) * 100 : null,
            format: "percent" as const,
            detail: funding
              ? `Rate for the next hourly settlement${next ? ` at ${clock(next)} (in ${Math.max(0, Math.round((next - now) / 60_000))} min)` : ""}; about ${(Number(funding.rate_1h) * 100 * 24 * 365).toFixed(2)}% a year at this rate.`
              : "No funding rate.",
          },
          {
            id: "oi",
            label: "Open interest",
            value: number(perp.open_interest),
            format: "quantity" as const,
            unit,
            detail: "Open positions, in the traded coin.",
          },
          {
            id: "volume",
            label: "24h volume",
            value: number(perp.day_volume),
            format: "quantity" as const,
            unit,
            detail: "Traded volume over the past 24 hours, in the traded coin.",
          },
        ]
      : []),
    ...(session?.reference_close
      ? [
          {
            id: "reference",
            label: "Reference close",
            value: Number(session.reference_close.value),
            detail: `${session.reference_close.dataset}, ${session.reference_close.market_data_type}.`,
          },
        ]
      : []),
  ];
  const tape: TradeDisplay[] = [];
  const seen = new Map<string, number>();
  for (const [time, tradePrice, size, side] of [...trades].reverse()) {
    const key = `${time}:${tradePrice}:${size}`;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    tape.push({ id: `${key}:${nth}`, time, price: tradePrice, size, side });
  }
  const drift = market.issues.filter((issue) => issue.code === "source_drift");
  const extra = market.issues.filter((issue) => issue.code === "source_extra");
  const gap = market.gaps.at(-1);
  const notes = [
    stale
      ? `Updates from ${label} are paused. Showing data from ${clock(market.retrieved_at)}.`
      : null,
    gap
      ? `Data was interrupted at ${clock(gap.start)} for ${Math.max(1, Math.round((gap.end - gap.start) / 1000))} s; trades from that time may be missing.`
      : null,
    ...market.issues
      .filter((issue) =>
        ["seed_unavailable", "book_empty", "clock_off"].includes(issue.code),
      )
      .map((issue) => issue.message ?? issue.code),
  ].filter(Boolean);
  return (
    <div data-slot="live-market" className="flex min-w-0 flex-col gap-3">
      <InstrumentQuoteHeader item={header} />
      {stats.length ? (
        <InstrumentStats stats={stats} precision={precision} />
      ) : null}
      {notes.length || drift.length || extra.length ? (
        <div className="flex flex-col gap-0.5 text-foreground-secondary text-xs">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          {drift.length ? (
            <p
              className="text-warning"
              title={drift.map((issue) => issue.message).join("\n")}
            >
              {label} sent data in an unexpected shape; the affected parts are
              left out.
            </p>
          ) : null}
          {extra.length ? (
            <p title={extra.map((issue) => issue.message).join("\n")}>
              {label} sent fields Pythia does not read; nothing was left out.
            </p>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "motion-standard grid @3xl:grid-cols-3 grid-cols-1 gap-4 transition-opacity",
          stale && "opacity-70",
        )}
      >
        <InstrumentChart
          item={chart}
          height={380}
          className="@3xl:col-span-2"
          emptyLabel="No trades in the past 15 minutes yet."
        />
        <div className="flex min-w-0 flex-col gap-4">
          {market.book ? (
            <OrderBookLadder
              book={{
                bids: market.book.bids.map(([levelPrice, size, orders]) => ({
                  price: levelPrice,
                  size,
                  orders,
                })),
                asks: market.book.asks.map(([levelPrice, size, orders]) => ({
                  price: levelPrice,
                  size,
                  orders,
                })),
                precision,
                unit,
                label: `${market.book.depth === "top" ? "Best bid and ask" : `Top ${Math.max(market.book.bids.length, market.book.asks.length)} levels`} at ${clock(market.book.time)}. ${provenance}`,
              }}
            />
          ) : (
            <p className="text-foreground-secondary text-xs">
              No order book from {label}.
            </p>
          )}
          <TradeTape
            trades={tape}
            precision={precision}
            unit={unit}
            dropped={market.trades?.dropped ?? 0}
          />
        </div>
      </div>
      <p className="sr-only">{provenance}</p>
    </div>
  );
}
