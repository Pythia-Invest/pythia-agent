"use client";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Clock,
  ClockAlert,
  Sunrise,
  Sunset,
  Moon,
  CircleHelp,
  CircleAlert,
  Pause,
  History,
} from "lucide-react";
import { cn } from "../class-name";
import { StatusHint } from "./status-hint";
import { instrumentNumber } from "./format";
import {
  activitySummary,
  activityDetail,
  instrumentActivity,
  sessionWords,
} from "./activity";
import type {
  InstrumentDisplay,
  InstrumentWidgetOptions,
  InstrumentStatus,
  InstrumentActivity,
} from "./types";
const statusClass: Record<InstrumentStatus, string> = {
  live: "bg-success",
  delayed: "bg-warning",
  extended: "bg-info",
  closed: "border border-foreground-secondary",
  halted: "bg-error",
  unavailable: "bg-error",
  unknown: "bg-foreground-secondary",
};
const sessionClass: Record<InstrumentActivity["session"], string> = {
  open: "bg-success",
  continuous: "bg-success",
  pre: "bg-info",
  post: "bg-info",
  closed: "border border-foreground-secondary",
  halted: "bg-error",
  unknown: "bg-foreground-secondary",
  "not-applicable": "rounded-none bg-foreground-secondary",
};
/** Static market-activity cue, never a claim of streaming or feed health.
 * Closed is hollow; unknown is neutral filled; indicators are square. Words
 * accompany color. Session overrides legacy status. Same semantics in both themes.
 * A 32px button surrounds the 6px mark, with hover, keyboard and tap explanation. */
export function InstrumentStatusDot({
  status,
  label,
  session,
}: {
  status: InstrumentStatus;
  label: string;
  session?: InstrumentActivity["session"] | undefined;
}) {
  return (
    <StatusHint slot="instrument-status" label={label}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-1.5 shrink-0 rounded-full",
          session ? sessionClass[session] : statusClass[status],
        )}
      />
    </StatusHint>
  );
}
/** Compact identity with independent session and data-quality explanations.
 * The caller supplies qualified activity and a display symbol, never a lookup ID.
 * Tile/table layouts share keyboard/touch controls in both themes; loading hides
 * those controls while preserving known text and geometry. Owns no navigation. */
export function InstrumentIdentity({
  item,
  options = {},
  loading = false,
  trailing,
  detail,
  layout = "tile",
}: {
  item: InstrumentDisplay;
  options?: InstrumentWidgetOptions | undefined;
  loading?: boolean;
  trailing?: ReactNode;
  detail?: string | undefined;
  layout?: "tile" | "table";
}) {
  const activity = instrumentActivity(item);
  const note = activitySummary(activity);
  const explanation = activityDetail(activity);
  const concern = ["stale", "unknown", "unavailable"].includes(activity.data);
  const Icon =
    activity.data === "unavailable"
      ? CircleAlert
      : activity.session === "halted"
        ? Pause
        : activity.data === "stale"
          ? ClockAlert
          : activity.data === "unknown"
            ? CircleHelp
            : activity.data === "previous"
              ? History
              : activity.session === "pre"
                ? Sunrise
                : activity.session === "post"
                  ? Sunset
                  : activity.data === "delayed"
                    ? Clock
                    : activity.session === "closed"
                      ? Moon
                      : activity.period
                        ? null
                        : null;
  const delayed = !loading && activity.data === "delayed";
  const statusNote = !loading &&
    options.note !== false &&
    (Icon || activity.period) && (
      <StatusHint
        slot="instrument-note"
        label={detail ? `${explanation} ${detail}` : explanation}
        className={cn(
          "text-[10px] text-foreground-secondary",
          layout === "table" ? "-my-2 shrink-0" : "-mr-2 ml-auto",
          concern && !loading && "text-warning",
          delayed && Icon === Clock && "text-warning",
          !concern &&
            (activity.session === "pre" || activity.session === "post") &&
            "text-info",
        )}
      >
        {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : note}
        {delayed && (Icon === Sunrise || Icon === Sunset) && (
          <Clock className="size-3.5 text-warning" aria-hidden="true" />
        )}
      </StatusHint>
    );
  return (
    <div
      data-slot="instrument-identity"
      className={cn(
        "flex w-full min-w-0 gap-1.5 text-left",
        layout === "table" ? "min-h-7 items-start" : "min-h-8 items-center",
      )}
    >
      {loading ? (
        <span
          className={cn(
            "-mr-1.5 -ml-3 size-8 shrink-0",
            layout === "table" && "-mt-2",
          )}
          aria-hidden="true"
        />
      ) : (
        <span
          className={cn(
            "-mr-1.5 -ml-3 inline-flex shrink-0",
            layout === "table" && "-mt-2",
          )}
        >
          <InstrumentStatusDot
            status={item.status}
            session={activity.session}
            label={sessionWords[activity.session]}
          />
        </span>
      )}
      <span
        className={cn(
          "min-w-0 flex-1",
          layout === "table"
            ? "block leading-3.5"
            : "flex items-baseline gap-1.5",
        )}
      >
        <span
          className={
            layout === "table" ? "flex min-w-0 items-center" : "contents"
          }
        >
          <span
            className={cn(
              "min-w-0 truncate font-semibold text-xs",
              options.compact && "max-w-full shrink-0",
              layout === "table" && "block leading-3.5",
            )}
            title={item.name ?? item.ticker}
          >
            {item.ticker}
          </span>
          {layout === "table" && statusNote}
        </span>
        {options.compact && options.name && item.name && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-foreground-secondary">
            {item.name}
          </span>
        )}
        {layout === "table" && (
          <span
            className="block min-h-3.5 truncate text-[11px] text-foreground-secondary leading-3.5"
            title={item.name}
          >
            {options.name !== false && item.name}
            {options.unit && item.unit
              ? `${options.name !== false && item.name ? " · " : ""}${item.unit}`
              : ""}
          </span>
        )}
      </span>
      {!loading && trailing}
      {layout !== "table" && statusNote}
    </div>
  );
}
/** Signed supplied changes, with an inspectable comparison basis. Percent,
 * absolute and both modes retain units (including basis points) and missingness.
 * Updates briefly highlight using semantic direction colors in either theme;
 * initial values and reduced-motion users do not animate. No return is computed. */
export function InstrumentChange({
  item,
  mode = "percent",
  wrap = false,
}: {
  item: InstrumentDisplay;
  mode?: InstrumentWidgetOptions["change"];
  wrap?: boolean;
}) {
  const activity = instrumentActivity(item);
  const unavailable = activity.data === "unavailable";
  const halted = activity.session === "halted";
  const change = unavailable ? undefined : item.change;
  const signed = (
    n: number | null | undefined,
    suffix: string,
    precision = 2,
  ) =>
    n == null
      ? "—"
      : `${n > 0 ? "+" : ""}${instrumentNumber(n, precision)}${suffix}`;
  const absolute = signed(
    change?.absolute,
    change?.unit ? ` ${change.unit}` : "",
    change?.unit === "bp" ? 1 : (item.precision ?? 2),
  );
  const percent = signed(change?.percent, "%");
  const direction = change?.percent ?? change?.absolute ?? 0;
  const text =
    change?.absolute == null && change?.percent == null
      ? "\u00a0"
      : mode === "absolute"
        ? absolute
        : mode === "both"
          ? change?.absolute == null
            ? percent
            : change?.percent == null
              ? absolute
              : `${absolute} (${percent})`
          : change?.unit === "bp"
            ? absolute
            : percent;
  const flash = useRef<HTMLSpanElement>(null);
  const previous = useRef({ id: item.id, text });
  useEffect(() => {
    const before = previous.current;
    previous.current = { id: item.id, text };
    if (
      before.id !== item.id ||
      before.text === text ||
      !before.text.trim() ||
      before.text.includes("—") ||
      text.includes("—") ||
      unavailable ||
      halted ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animation = flash.current?.animate(
      [{ opacity: 0.22 }, { opacity: 0 }],
      {
        duration: 900,
        easing: "ease-out",
      },
    );
    return () => animation?.cancel();
  }, [item.id, unavailable, halted, text]);
  return (
    <span
      data-slot="instrument-change"
      title={change?.basis}
      className={cn(
        "relative isolate whitespace-nowrap font-semibold text-[11.5px] tabular-nums",
        wrap && "whitespace-normal",
        halted || unavailable || direction === 0
          ? "text-foreground-secondary"
          : direction > 0
            ? "text-market-up"
            : "text-market-down",
      )}
    >
      <span
        ref={flash}
        aria-hidden="true"
        data-slot="instrument-change-flash"
        className="pointer-events-none absolute -inset-x-0.5 inset-y-0 -z-10 rounded-sm bg-current opacity-0"
      />
      {wrap &&
      mode === "both" &&
      change &&
      change.absolute != null &&
      change.percent != null ? (
        <>
          <span className="whitespace-nowrap">{absolute}</span>{" "}
          <span className="whitespace-nowrap">({percent})</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
/** Formats a supplied price at the caller's precision, preserving its suffix.
 * Missing/unavailable values are a dash; halted values remain neutral in either
 * theme. The caller supplies currency/unit context and owns quote freshness. */
export function InstrumentPrice({ item }: { item: InstrumentDisplay }) {
  const activity = instrumentActivity(item);
  const unavailable = activity.data === "unavailable";
  const price = unavailable ? null : item.price;
  return (
    <span
      data-slot="instrument-price"
      className={cn(
        "whitespace-nowrap font-semibold tabular-nums",
        (activity.session === "halted" || unavailable) &&
          "text-foreground-secondary",
      )}
    >
      {instrumentNumber(price, item.precision)}
      {price != null ? item.priceSuffix : ""}
    </span>
  );
}
