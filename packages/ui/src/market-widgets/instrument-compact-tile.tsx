import { cn } from "../class-name";
import { Skeleton } from "../feedback/skeleton";
import type { InstrumentDisplay, InstrumentWidgetOptions } from "./types";
import {
  InstrumentIdentity,
  InstrumentPrice,
  InstrumentChange,
} from "./values";
import {
  InstrumentExtendedSummary,
  extendedDescription,
} from "./extended-change";

/** Two-line, chart-free instrument summary. Same quote/session semantics as a
 * full tile. Name yields to the ticker and status; extended change stays visible.
 * Known identity and static loading placeholders reserve geometry. Status targets
 * support keyboard/touch; motion respects reduced motion in both themes/profiles.
 * Data retrieval, source selection and number semantics belong to the caller. */
export function InstrumentCompactTile({
  item,
  options = {},
  className,
  loading = false,
}: {
  item: InstrumentDisplay;
  options?: InstrumentWidgetOptions | undefined;
  className?: string | undefined;
  loading?: boolean;
}) {
  return (
    <article
      data-slot="instrument-compact-tile"
      aria-label={item.ticker || item.name || "Instrument"}
      aria-busy={loading || undefined}
      className={cn(
        "min-w-0 rounded-control border border-border bg-raised px-2.5 py-1.5 text-foreground",
        className,
      )}
    >
      <InstrumentIdentity
        item={item}
        loading={loading}
        options={{ ...options, compact: true }}
        detail={extendedDescription(item)}
        trailing={<InstrumentExtendedSummary item={item} />}
      />
      <div className="relative flex min-h-5 items-baseline justify-between gap-2">
        <div
          className={cn("contents", loading && "invisible")}
          aria-hidden={loading || undefined}
        >
          <span className="text-sm">
            <InstrumentPrice item={item} />
            {options.unit && item.unit && (
              <span className="ml-1 text-[10px] text-foreground-secondary">
                {item.unit}
              </span>
            )}
          </span>
          <InstrumentChange item={item} mode={options.change} />
        </div>
        {loading && (
          <div
            className="absolute inset-0 flex items-center justify-between gap-3"
            aria-hidden="true"
          >
            <Skeleton className="w-16 after:hidden" />
            <Skeleton className="w-12 after:hidden" />
          </div>
        )}
      </div>
    </article>
  );
}
