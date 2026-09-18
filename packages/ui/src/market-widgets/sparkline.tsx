"use client";
import { useId } from "react";
import { cn } from "../class-name";
import { instrumentPathGeometry } from "./path-geometry";
import type { InstrumentPath } from "./types";
/** Time-scaled path with baseline-crossing colors and genuine gaps. An absent
 * baseline stays neutral. Host owns source, period, timestamps and completion.
 * SVG title supplies the textual equivalent; themes use semantic market colors. */
export function InstrumentSparkline({
  series,
  height = 28,
  muted = false,
  dot = true,
  className,
}: {
  series: InstrumentPath;
  height?: number;
  muted?: boolean;
  dot?: boolean;
  className?: string;
}) {
  const id = useId().replaceAll(":", ""),
    g = instrumentPathGeometry(series);
  if (!g)
    return (
      <span
        data-slot="instrument-sparkline"
        className="text-[10px] text-foreground-secondary"
      >
        No path
      </span>
    );
  const baseline = g.baselineY;
  const label = `${series.label}${series.baseline ? ` · baseline: ${series.baseline.label}` : " · no comparable baseline"}`;
  return (
    <span
      data-slot="instrument-path"
      style={{ height: Math.max(16, Math.min(64, height)) }}
      className={cn("relative block w-full", muted && "opacity-70", className)}
    >
      <svg
        data-slot="instrument-sparkline"
        role="img"
        aria-label={label}
        viewBox="0 0 120 34"
        preserveAspectRatio="none"
        className="block size-full overflow-visible"
      >
        <title>{label}</title>
        <defs>
          <clipPath id={`${id}-up`}>
            <rect width="120" height={baseline ?? 34} />
          </clipPath>
          <clipPath id={`${id}-down`}>
            <rect y={baseline ?? 0} width="120" height={34 - (baseline ?? 0)} />
          </clipPath>
          <linearGradient
            className="text-market-up"
            id={`${id}-fill-up`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient
            className="text-market-down"
            id={`${id}-fill-down`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.02" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.25" />
          </linearGradient>
          <mask id={`${id}-extended`}>
            {g.regularX ? (
              <>
                <rect width="120" height="34" fill="white" fillOpacity="0.55" />
                <rect
                  x={g.regularX.start}
                  width={g.regularX.end - g.regularX.start}
                  height="34"
                  fill="white"
                />
              </>
            ) : (
              <>
                <rect width={g.extendedX ?? 120} height="34" fill="white" />
                {g.extendedX !== undefined && (
                  <rect
                    x={g.extendedX}
                    width={120 - g.extendedX}
                    height="34"
                    fill="white"
                    fillOpacity="0.55"
                  />
                )}
              </>
            )}
          </mask>
        </defs>
        {baseline !== undefined && (
          <line
            x1="0"
            x2="120"
            y1={baseline}
            y2={baseline}
            stroke="currentColor"
            strokeWidth="0.7"
            strokeDasharray="2 2"
            className="text-foreground-secondary"
          />
        )}
        {g.regularX &&
          [
            { x: g.regularX.start, label: "Regular market opens" },
            { x: g.regularX.end, label: "Regular market closes" },
          ]
            .filter((b) => b.x > 0 && b.x < 120)
            .map((b) => (
              <line
                key={b.label}
                data-slot="instrument-session-boundary"
                x1={b.x}
                x2={b.x}
                y1="0"
                y2="34"
                stroke="currentColor"
                strokeWidth="0.6"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
                className="text-foreground-secondary"
              >
                <title>{b.label}</title>
              </line>
            ))}
        {!g.regularX && g.extendedX !== undefined && (
          <line
            x1={g.extendedX}
            x2={g.extendedX}
            y1="0"
            y2="34"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeDasharray="2 2"
            className="text-foreground-secondary"
          />
        )}
        <g mask={`url(#${id}-extended)`}>
          {g.segments.map(({ path, area }) =>
            baseline === undefined || g.flat ? (
              <path
                key={path}
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.35"
                vectorEffect="non-scaling-stroke"
                className="text-foreground-secondary"
              />
            ) : (
              <g key={path}>
                <path
                  d={area}
                  clipPath={`url(#${id}-up)`}
                  fill={`url(#${id}-fill-up)`}
                  className="text-market-up"
                />
                <path
                  d={area}
                  clipPath={`url(#${id}-down)`}
                  fill={`url(#${id}-fill-down)`}
                  className="text-market-down"
                />
                <path
                  d={path}
                  clipPath={`url(#${id}-up)`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  vectorEffect="non-scaling-stroke"
                  className="text-market-up"
                />
                <path
                  d={path}
                  clipPath={`url(#${id}-down)`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  vectorEffect="non-scaling-stroke"
                  className="text-market-down"
                />
              </g>
            ),
          )}
        </g>
      </svg>
      {dot && !muted && (
        <span
          data-slot="instrument-path-tail"
          aria-hidden="true"
          style={{
            left: `${(g.last.x / 120) * 100}%`,
            top: `${(g.last.y / 34) * 100}%`,
          }}
          className={cn(
            "pointer-events-none absolute size-1 -translate-x-1/2 -translate-y-1/2",
            baseline === undefined
              ? "text-foreground-secondary"
              : g.last.y < baseline
                ? "text-market-up"
                : g.last.y > baseline
                  ? "text-market-down"
                  : "text-foreground-secondary",
          )}
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-40 motion-reduce:animate-none motion-reduce:opacity-0" />
          <span className="absolute inset-0 rounded-full bg-current" />
        </span>
      )}
    </span>
  );
}
