"use client";
import { useMemo, useState, type PointerEvent } from "react";
import { cn } from "../class-name";
import { Skeleton } from "../feedback/skeleton";
import { instrumentActivity, instrumentPathActive } from "./activity";
import { instrumentNumber } from "./format";
import { instrumentPathGeometry } from "./path-geometry";
import { PathGraphic, type PathGeometry } from "./sparkline";
import type { InstrumentDisplay } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function formatter(timeZone: string | undefined, options: object) {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("en-GB", options);
  }
}

/** Round price levels inside the drawn range; no invented range padding. */
function valueTicks(low: number, high: number) {
  if (!(high > low)) return [low];
  const rough = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= rough) ??
    10 * power;
  const ticks: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high + step * 1e-9; v += step)
    ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** Calendar-aligned labels in the supplied zone. Omitted closed intervals
 * carry no labels; the domain itself is never widened to reach a label. */
function timeTicks(g: PathGeometry, timeZone: string | undefined) {
  const { start, end, gap } = g.scale;
  const span = end - start - (gap ? gap.end - gap.start : 0);
  const visible = (t: number) =>
    t >= start && t <= end && !(gap && t > gap.start && t < gap.end);
  const ticks: { time: number; label: string }[] = [];
  if (span > 20 * DAY) {
    const first = new Date(start);
    const months = Math.ceil(span / (30 * DAY));
    const step = [1, 2, 3, 6, 12, 24, 60].find((s) => months / s <= 7) ?? 120;
    const month = formatter("UTC", { month: "short" });
    let y = first.getUTCFullYear(),
      m = first.getUTCMonth() + 1;
    for (;;) {
      if (m > 11) {
        y += Math.floor(m / 12);
        m %= 12;
      }
      const time = Date.UTC(y, m, 1);
      if (time > end) break;
      if ((y * 12 + m) % step === 0 && visible(time))
        ticks.push({
          time,
          label: step >= 12 || m === 0 ? String(y) : month.format(time),
        });
      m += 1;
    }
    return ticks;
  }
  const hourOf = formatter(timeZone, { hour: "numeric", hourCycle: "h23" });
  const hours = span / HOUR;
  const daily = hours > 36;
  const step = daily
    ? ([1, 2, 7].find((s) => hours / 24 / s <= 7) ?? 14)
    : ([1, 2, 3, 4, 6, 12].find((s) => hours / s <= 8) ?? 24);
  const label = daily
    ? formatter(timeZone, { weekday: "short", day: "numeric" })
    : formatter(timeZone, { hour: "2-digit", minute: "2-digit" });
  let dayIndex = 0;
  for (let t = Math.ceil(start / HOUR) * HOUR; t <= end; t += HOUR) {
    const hour = Number(hourOf.format(t));
    const keep = daily
      ? hour === 0 && dayIndex++ % step === 0
      : hour % step === 0;
    if (keep && visible(t)) ticks.push({ time: t, label: label.format(t) });
  }
  return ticks;
}

/**
 * Page-scale price history in the same visual language as the sparkline:
 * baseline-crossing colors, subdued extended hours, dashed session bounds and
 * retained gaps and uncovered time. It adds price and time axes and a pointer
 * readout. Loading and unavailable states keep the chart's height. The host
 * supplies the path, its domain and baseline; nothing is resampled here.
 */
export function InstrumentChart({
  item,
  height = 240,
  loading = false,
  emptyLabel,
  className,
}: {
  item: InstrumentDisplay;
  height?: number;
  loading?: boolean;
  /** Explanation when no path is supplied, such as an unsupported period. */
  emptyLabel?: string | undefined;
  className?: string;
}) {
  const series = item.path;
  const g = useMemo(
    () => (series ? instrumentPathGeometry(series) : null),
    [series],
  );
  const activity = instrumentActivity(item);
  const active = instrumentPathActive(item);
  const [hover, setHover] = useState<number | null>(null);
  const zone = series?.timeZone;
  const dates = series?.dates === true;
  const ticks = useMemo(
    () =>
      g
        ? {
            values: valueTicks(g.scale.low, g.scale.high),
            times: timeTicks(g, dates ? "UTC" : zone),
          }
        : null,
    [g, zone, dates],
  );
  const pointLabel = useMemo(
    () =>
      dates
        ? formatter("UTC", { dateStyle: "medium" })
        : formatter(zone, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZoneName: "short",
          }),
    [zone, dates],
  );
  const unavailable = activity.data === "unavailable";
  const pending = loading || (!series && item.pathState === "loading");
  if (pending || unavailable || !series || !g || !ticks)
    return (
      <div
        data-slot="instrument-chart"
        style={{ height: height + 24 }}
        className={cn("flex items-center justify-center", className)}
      >
        {pending ? (
          <div
            role="status"
            aria-label="Loading price history"
            className="flex w-full items-center justify-center"
          >
            <Skeleton className="h-1 w-16 after:hidden motion-safe:animate-pulse" />
          </div>
        ) : (
          <p className="max-w-sm text-center text-foreground-secondary text-xs">
            {series && !g
              ? "This price history cannot be drawn."
              : (emptyLabel ??
                (unavailable || item.pathState === "unavailable"
                  ? "Price history unavailable"
                  : "No price history"))}
          </p>
        )}
      </div>
    );
  const points = series.points;
  const nearest =
    hover === null
      ? undefined
      : points.reduce((best, point) =>
          Math.abs(g.scale.x(point.time) - hover) <
          Math.abs(g.scale.x(best.time) - hover)
            ? point
            : best,
        );
  const track = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(((event.clientX - box.left) / box.width) * 120);
  };
  const left = (x: number) => `${(x / 120) * 100}%`;
  const top = (y: number) => `${(y / 34) * 100}%`;
  const muted =
    !active && (activity.session === "closed" || activity.session === "halted");
  return (
    <div
      data-slot="instrument-chart"
      className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-2", className)}
    >
      <div
        className={cn("relative touch-pan-y", muted && "opacity-80")}
        style={{ height }}
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.values.map((value) => (
          <div
            key={value}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-border/50 border-t"
            style={{ top: top(g.scale.y(value)) }}
          />
        ))}
        <PathGraphic series={series} g={g} dot={active} muted={muted} page />
        {nearest && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 border-foreground-secondary/60 border-l"
              style={{ left: left(g.scale.x(nearest.time)) }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
              style={{
                left: left(g.scale.x(nearest.time)),
                top: top(g.scale.y(nearest.value)),
              }}
            />
            <div
              data-slot="instrument-chart-readout"
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute top-0 whitespace-nowrap rounded-control border border-border bg-overlay px-2 py-1 text-[11px] text-foreground tabular-nums shadow-popup",
                g.scale.x(nearest.time) > 60
                  ? "-ml-2 -translate-x-full"
                  : "ml-2",
              )}
              style={{ left: left(g.scale.x(nearest.time)) }}
            >
              <span className="font-semibold">
                {instrumentNumber(nearest.value, item.precision)}
              </span>{" "}
              <span className="text-foreground-secondary">
                {pointLabel.format(nearest.time)}
              </span>
            </div>
          </>
        )}
      </div>
      <div
        aria-hidden="true"
        className="relative min-w-10 text-[10px] text-foreground-secondary tabular-nums"
        style={{ height }}
      >
        {ticks.values.map((value) => (
          <span
            key={value}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: top(g.scale.y(value)) }}
          >
            {instrumentNumber(value, item.precision)}
          </span>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="relative mt-1 h-4 text-[10px] text-foreground-secondary tabular-nums"
      >
        {ticks.times.map(({ time, label }) => (
          <span
            key={time}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: left(g.scale.x(time)) }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
