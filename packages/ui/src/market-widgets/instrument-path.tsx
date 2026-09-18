import { Skeleton } from "../feedback/skeleton";
import { InstrumentSparkline } from "./sparkline";
import { instrumentActivity, instrumentPathActive } from "./activity";
import type { InstrumentDisplay } from "./types";

/** Shared chart presentation; geometry and session evidence stay in the path.
 * Quotes can render while history loads. Empty/error paths reserve their space. */
export function InstrumentPathView({
  item,
  height = 28,
  loading = false,
}: {
  item: InstrumentDisplay;
  height?: number;
  loading?: boolean;
}) {
  const active = instrumentPathActive(item);
  const activity = instrumentActivity(item);
  const unavailable = activity.data === "unavailable";
  const size = Math.max(16, Math.min(64, height));
  return (
    <div data-slot="instrument-path" style={{ height: size }}>
      {loading || (!item.path && item.pathState === "loading") ? (
        <div
          data-slot="instrument-path-loading"
          role="status"
          aria-label="Loading price history"
          className="flex h-full items-center"
        >
          <Skeleton className="h-1 w-10 after:hidden motion-safe:animate-pulse" />
        </div>
      ) : !unavailable && item.path ? (
        <InstrumentSparkline
          series={item.path}
          height={size}
          dot={active}
          muted={
            !active &&
            (activity.session === "closed" || activity.session === "halted")
          }
        />
      ) : (
        <span
          className="flex h-full items-center justify-center text-foreground-secondary"
          role="img"
          aria-label={
            unavailable || item.pathState === "unavailable"
              ? "Price history unavailable"
              : "No price history"
          }
        >
          —
        </span>
      )}
    </div>
  );
}
