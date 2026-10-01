"use client";
import { Toggle, ToggleGroup } from "../actions/toggle";
import { cn } from "../class-name";
import { Skeleton } from "../feedback/skeleton";
import { InstrumentExtendedSummary } from "./extended-change";
import { instrumentNumber } from "./format";
import {
  InstrumentChange,
  InstrumentIdentity,
  InstrumentPrice,
} from "./values";
import type { InstrumentDisplay } from "./types";

/** A supplied change over an explicit, labelled comparison period. */
export type InstrumentPeriodChange = {
  absolute: number | null;
  percent: number | null;
  /** Visible basis, such as "Past 6 months" or "Since previous close". */
  label: string;
  /** Full comparison basis for inspection. */
  basis: string;
};

/**
 * Page-scale quote: the tiles' identity row (activity dot, status icon with a
 * plain-language hover), the regular
 * price with unit and its supplied change, an optional extended-hours quote
 * and an optional change for the selected chart period. Loading keeps the
 * geometry with static placeholders; unavailable prices stay a dash.
 */
export function InstrumentQuoteHeader({
  item,
  loading = false,
  periodChange,
  className,
}: {
  item: InstrumentDisplay;
  loading?: boolean;
  periodChange?: InstrumentPeriodChange | undefined;
  className?: string;
}) {
  return (
    <div
      data-slot="instrument-quote-header"
      aria-busy={loading || undefined}
      className={cn("flex min-w-0 flex-col gap-1", className)}
    >
      {/* The tiles' identity row: activity dot and ticker on the left,
          status icon with a plain-language hover on the right. */}
      <InstrumentIdentity
        item={item}
        options={{ name: false }}
        loading={loading}
      />
      <div className="flex min-h-9 flex-wrap items-baseline gap-x-3 gap-y-1">
        {loading ? (
          <Skeleton className="h-8 w-40 after:hidden" />
        ) : (
          <>
            <span className="text-3xl leading-none">
              <InstrumentPrice item={item} />
              {item.priceLabel && (
                <span className="ml-1.5 font-normal text-foreground-secondary text-sm">
                  {item.priceLabel}
                </span>
              )}
              {item.unit && (
                <span className="ml-1.5 font-normal text-foreground-secondary text-sm">
                  {item.unit}
                </span>
              )}
            </span>
            <InstrumentChange item={item} mode="both" className="text-base" />
            {item.change?.basis && (
              <span className="text-foreground-secondary text-xs">
                {item.change.basis}
              </span>
            )}
          </>
        )}
      </div>
      {!loading && (item.extended || periodChange) && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <InstrumentExtendedSummary item={item} />
          {periodChange && (
            <span
              data-slot="instrument-period-change"
              title={periodChange.basis}
              className="inline-flex items-baseline gap-1.5"
            >
              <span className="text-foreground-secondary">
                {periodChange.label}
              </span>
              <InstrumentChange
                item={{
                  ...item,
                  id: `${item.id}:period`,
                  change: {
                    absolute: periodChange.absolute,
                    percent: periodChange.percent,
                    basis: periodChange.basis,
                  },
                }}
                mode="both"
                className="text-xs"
              />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export type InstrumentStat = {
  id: string;
  label: string;
  /** A single value, or a low–high range. Missing values render as a dash. */
  value?: number | null | undefined;
  range?: { low: number | null; high: number | null } | undefined;
  /** `percent` shows a signed rate already in percent (0.00125 → +0.00125%). */
  format?: "price" | "quantity" | "percent" | undefined;
  /** Unit after the value, such as a coin for open interest. */
  unit?: string | undefined;
  /** Source, observation time and derivation, for inspection. */
  detail: string;
};

const quantity = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/** Labelled statistics strip. Supply only fields the source provides; each
 * carries its own provenance. Wraps to fit narrow containers. */
export function InstrumentStats({
  stats,
  precision,
  loading = false,
  className,
}: {
  stats: readonly InstrumentStat[];
  precision?: number | undefined;
  loading?: boolean;
  className?: string;
}) {
  const text = (stat: InstrumentStat, value: number | null | undefined) =>
    value == null || !Number.isFinite(value)
      ? "—"
      : `${
          stat.format === "quantity"
            ? quantity.format(value)
            : stat.format === "percent"
              ? `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}%`
              : instrumentNumber(value, precision)
        }${stat.unit ? ` ${stat.unit}` : ""}`;
  return (
    <dl
      data-slot="instrument-stats"
      aria-busy={loading || undefined}
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-4 gap-y-2 text-xs",
        className,
      )}
    >
      {stats.map((stat) => (
        <div
          key={stat.id}
          className="flex min-w-0 flex-col"
          title={stat.detail}
        >
          <dt className="truncate text-foreground-secondary">{stat.label}</dt>
          <dd className="truncate font-semibold text-foreground tabular-nums">
            {loading ? (
              <Skeleton className="w-16 after:hidden" />
            ) : stat.range ? (
              `${text(stat, stat.range.low)} – ${text(stat, stat.range.high)}`
            ) : (
              text(stat, stat.value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type InstrumentPeriodOption = {
  id: string;
  label: string;
};

/** Exclusive chart-period choice with roving arrow-key focus. */
export function InstrumentPeriodSelector({
  periods,
  value,
  onValueChange,
  label = "Chart period",
  className,
}: {
  periods: readonly InstrumentPeriodOption[];
  value: string;
  onValueChange(value: string): void;
  label?: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      label={label}
      value={[value]}
      onValueChange={(next) => {
        const selected = next[0];
        if (selected) onValueChange(selected);
      }}
      className={cn("flex-wrap p-0.5", className)}
    >
      {periods.map((period) => (
        <Toggle
          key={period.id}
          value={period.id}
          label={period.label}
          appearance="ghost"
          size="sm"
          className="h-7 px-2.5"
        />
      ))}
    </ToggleGroup>
  );
}
