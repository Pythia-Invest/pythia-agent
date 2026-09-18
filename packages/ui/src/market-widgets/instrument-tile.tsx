import { cn } from "../class-name";
import type { InstrumentDisplay, InstrumentWidgetOptions } from "./types";
import {
  InstrumentIdentity,
  InstrumentChange,
  InstrumentPrice,
} from "./values";
import { instrumentNumber } from "./format";
import { instrumentActivity } from "./activity";
import { InstrumentPathView } from "./instrument-path";
import { Skeleton } from "../feedback/skeleton";
import { InstrumentCompactTile } from "./instrument-compact-tile";
/** Compact instrument tile. Switches control name, note, unit, change, path and
 * range. Compact mode is two lines. Unavailable prices are withheld. Extended
 * quotes never replace the official value. Adapters, not this component, own
 * financial semantics. Loading retains the same geometry and known identity;
 * prices use static placeholders; chart-only pulse respects reduced motion. All profiles/themes share
 * the same dense geometry. */
export function InstrumentTile({
  item,
  options = {},
  className,
  loading = false,
}: {
  item: InstrumentDisplay;
  options?: InstrumentWidgetOptions | undefined;
  className?: string;
  loading?: boolean;
}) {
  if (options.compact)
    return (
      <InstrumentCompactTile
        item={item}
        options={options}
        className={className}
        loading={loading}
      />
    );
  const unavailable = instrumentActivity(item).data === "unavailable";
  return (
    <article
      data-slot="instrument-tile"
      aria-label={item.ticker || item.name || "Instrument"}
      aria-busy={loading || undefined}
      className={cn(
        "min-w-0 rounded-control border border-border bg-raised px-2.5 py-2 text-foreground",
        className,
      )}
    >
      <InstrumentIdentity item={item} options={options} loading={loading} />
      {options.name !== false && item.name && (
        <div className="mt-0.5 truncate text-[11px] text-foreground-secondary">
          {item.name}
        </div>
      )}
      <div className="relative mt-1">
        <div
          className={cn("contents", loading && "invisible")}
          aria-hidden={loading || undefined}
        >
          <div className="text-base leading-tight">
            <InstrumentPrice item={item} />
            {item.priceLabel && (
              <span className="ml-1 text-[10px] text-foreground-secondary">
                {item.priceLabel}
              </span>
            )}
            {options.unit && item.unit && (
              <span className="ml-1 text-[10px] text-foreground-secondary">
                {item.unit}
              </span>
            )}
          </div>
          <InstrumentChange item={item} mode={options.change} />
        </div>
        {loading && (
          <div className="absolute inset-0 flex flex-col justify-around gap-1">
            <Skeleton className="w-20 after:hidden" />
            <Skeleton className="w-24 after:hidden" />
          </div>
        )}
      </div>
      {!unavailable && item.extended && (
        <div className="relative mt-1">
          <div
            data-slot="instrument-extended"
            aria-hidden={loading || undefined}
            className={cn(
              "flex items-baseline gap-1 text-[10px] tabular-nums",
              loading && "invisible",
            )}
          >
            <span>
              <span className="text-foreground-secondary">
                {item.extended.label}
              </span>{" "}
              {instrumentNumber(item.extended.price, item.precision)}{" "}
            </span>
            <InstrumentChange
              item={{
                ...item,
                id: `${item.id}:extended`,
                status: "extended",
                change: {
                  absolute: item.extended.absolute,
                  percent: item.extended.percent,
                  basis: "Since the last regular close",
                },
              }}
              mode="percent"
            />
          </div>
          {loading && (
            <Skeleton className="absolute inset-y-0 left-0 my-auto w-24 text-[10px] after:hidden" />
          )}
        </div>
      )}
      {options.path !== false && (
        <div
          className="mt-1.5"
          style={{
            minHeight: Math.max(16, Math.min(64, options.pathHeight ?? 28)),
          }}
        >
          {loading ||
          item.pathState === "loading" ||
          (!unavailable && item.path) ? (
            <>
              {!loading && item.path?.period && (
                <span className="text-[9px] text-foreground-secondary">
                  {item.path.period}
                </span>
              )}
              <InstrumentPathView
                item={item}
                loading={loading}
                height={options.pathHeight ?? 28}
              />
            </>
          ) : !unavailable && item.ohl ? (
            <div
              data-slot="instrument-ohl"
              className="flex flex-wrap justify-between gap-1 pt-2 text-[10px] tabular-nums"
            >
              {(
                [
                  ["O", item.ohl.open],
                  ["H", item.ohl.high],
                  ["L", item.ohl.low],
                ] as const
              ).map(([label, value]) => (
                <span key={label}>
                  {label} {instrumentNumber(value, item.precision)}
                </span>
              ))}
            </div>
          ) : (
            <p className="pt-2 text-[10px] text-foreground-secondary">
              {unavailable
                ? "Last good quote withheld."
                : item.pathState === "unavailable"
                  ? "Path unavailable"
                  : "No intraday data"}
            </p>
          )}
        </div>
      )}
      {options.range && !unavailable && item.ohl && (
        <div className="relative mt-1">
          <div
            data-slot="instrument-range"
            aria-hidden={loading || undefined}
            className={cn(
              "flex justify-between gap-2 text-[10px] text-foreground-secondary tabular-nums",
              loading && "invisible",
            )}
          >
            <span>Low {instrumentNumber(item.ohl.low, item.precision)}</span>
            <span>High {instrumentNumber(item.ohl.high, item.precision)}</span>
          </div>
          {loading && (
            <div
              className="absolute inset-0 flex items-center justify-between gap-2 text-[10px]"
              aria-hidden="true"
            >
              <Skeleton className="w-14 after:hidden" />
              <Skeleton className="w-14 after:hidden" />
            </div>
          )}
        </div>
      )}
      {(options.book ?? Boolean(item.book)) &&
        (item.book && !unavailable ? (
          <div className="relative mt-1.5">
            <dl
              data-slot="instrument-book"
              aria-hidden={loading || undefined}
              aria-label={item.book.label}
              title={loading ? undefined : item.book.label}
              className={cn(
                "grid min-h-8 grid-cols-2 gap-x-2 text-[10px] text-foreground-secondary tabular-nums",
                loading && "invisible",
              )}
            >
              <div>
                <dt>Bid</dt>
                <dd>
                  {instrumentNumber(item.book.bid, item.precision)} ×{" "}
                  {instrumentNumber(item.book.bidSize, 0)}
                </dd>
              </div>
              <div className="text-right">
                <dt>Ask</dt>
                <dd>
                  {instrumentNumber(item.book.ask, item.precision)} ×{" "}
                  {instrumentNumber(item.book.askSize, 0)}
                </dd>
              </div>
            </dl>
            {loading && (
              <div
                className="absolute inset-0 flex items-center justify-between gap-2 text-[10px]"
                aria-hidden="true"
              >
                <Skeleton className="w-14 after:hidden" />
                <Skeleton className="w-14 after:hidden" />
              </div>
            )}
          </div>
        ) : (
          <div
            data-slot="instrument-book-loading"
            role="status"
            className="mt-1.5 min-h-8"
            aria-label="Bid and ask not yet available"
          />
        ))}
    </article>
  );
}
