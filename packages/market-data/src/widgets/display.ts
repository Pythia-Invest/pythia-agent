import type { ObservationTime, ReadResult, Series } from "../index";
import type { InstrumentDisplay, InstrumentPath } from "@pythia/widget-sdk";
import type { TimestampFormatter } from "./types";
import { bindingKey, type FinancialRow } from "./contract";

function number(value: string | undefined, scale = "1") {
  if (value === undefined) return null;
  const result = Number(value) * Number(scale);
  return Number.isFinite(result) ? result : null;
}
function field(series: Series) {
  return "value" in series.fields ? series.fields.value : series.fields.close;
}
function timeLabel(
  time: ObservationTime | undefined,
  format: TimestampFormatter,
) {
  return !time || time.kind === "unknown"
    ? "Observation time unknown"
    : time.kind === "session_date"
      ? time.value
      : format(time.value);
}
function semantics(series: Series) {
  const unit = field(series).unit;
  return `${series.provider_ref.provider} · ${series.provider_ref.native_id} · ${series.measurement.replaceAll("_", " ")} · ${unit.kind === "currency" ? unit.code : unit.kind} · ${series.interval.count} ${series.interval.kind} · ${field(series).adjustment.kind.replaceAll("_", " ")} adjustment · ${series.session} session`;
}
function path(
  result: ReadResult | undefined,
  presentation: "session" | "window" | undefined,
): InstrumentPath | undefined {
  if (!result?.series || result.outcome === "error") return undefined;
  const series = result.series;
  const scale = field(series).unit.scale;
  // These numbers are drawing coordinates only. A session date remains a date
  // in the contract and accessible label; it is never exposed as a UTC instant.
  const coordinate = (time: ObservationTime | null) =>
    time && time.kind !== "unknown" ? Date.parse(time.value) : NaN;
  let points = result.observations.flatMap((observation) => {
    const time = coordinate(observation.time);
    const value = number(
      observation.shape === "scalar" ? observation.value : observation.close,
      scale,
    );
    return Number.isFinite(time) && value !== null ? [{ time, value }] : [];
  });
  if (points.length < 2) return undefined;
  const sessionEvidence = result.price_context?.session_window;
  // Request windows describe retrieval, not a single-session display. Only an
  // explicit session view may narrow instant observations to supplied bounds.
  const session =
    presentation === "session" &&
    result.observations.every(
      (observation) => observation.time.kind === "instant",
    )
      ? sessionEvidence
      : undefined;
  const close = result.price_context?.reference_close;
  const referenceValue = close ? number(close.value, close.unit.scale) : null;
  const regular = session
    ? {
        start: Date.parse(session.regular.start),
        end: Date.parse(session.regular.end),
      }
    : undefined;
  const sessionWindow =
    session && regular
      ? {
          start:
            series.session === "regular"
              ? regular.start
              : Date.parse(session.extended.start),
          end:
            series.session === "regular"
              ? regular.end
              : Date.parse(session.extended.end),
        }
      : undefined;
  if (sessionWindow)
    points = points.filter(
      (point) =>
        point.time >= sessionWindow.start && point.time <= sessionWindow.end,
    );
  const first = points[0];
  if (points.length < 2 || !first) return undefined;
  const start = coordinate(result.request.window.start),
    end = coordinate(result.request.window.end);
  const intervalMs =
    series.interval.count *
    { tick: 0, minute: 60_000, hour: 3_600_000, day: 86_400_000, unknown: 0 }[
      series.interval.kind
    ];
  return {
    points,
    live:
      series.read_support?.updates === "push" &&
      result.freshness.status === "fresh",
    label: `${semantics(series)} · ${result.returned_window.start?.kind === "session_date" ? "Session dates" : "Observation times"} · ${result.coverage.status} coverage${session ? ` · Session view: ${session.date} (${session.timezone}), ${series.session === "regular" ? "regular" : "full supplied"} trading hours` : ""}`,
    ...(close && referenceValue !== null
      ? {
          baseline: {
            value: referenceValue,
            label: `Previous close · ${close.provider_ref.provider} · ${close.dataset}`,
          },
        }
      : !sessionEvidence
        ? {
            baseline: {
              value: first.value,
              label: "First observation in this series window",
            },
          }
        : {}),
    ...(sessionWindow
      ? { session: sessionWindow, regularSession: regular }
      : Number.isFinite(start) && end > start
        ? { window: { start, end } }
        : {}),
    ...(Number.isFinite(intervalMs) && intervalMs > 0 ? { intervalMs } : {}),
  };
}
/** One financial-contract adapter for every standard instrument renderer. No
 * provider names, source request formats or cross-provider matching rules. */
export function financialInstrument(
  row: FinancialRow,
  quote: ReadResult | undefined,
  history: ReadResult | undefined,
  historyLoading: boolean,
  format: TimestampFormatter,
): InstrumentDisplay {
  const available =
    quote &&
    quote.outcome !== "error" &&
    quote.series &&
    quote.observations.length > 0;
  const observation = available ? quote.observations.at(-1) : undefined;
  const series = available ? quote.series : undefined;
  const context = available ? quote.price_context : undefined;
  const unit = series && field(series).unit;
  const price = observation
    ? number(
        observation.shape === "scalar" ? observation.value : observation.close,
        unit?.scale,
      )
    : null;
  const session = context?.session?.state;
  const delay = context?.delay_seconds;
  const delayed =
    delay !== undefined
      ? delay > 0
      : quote?.freshness.market_data_type === "delayed" ||
        quote?.freshness.market_data_type === "delayed_frozen";
  const change = context?.change;
  const basis =
    change?.baseline.kind === "previous_close"
      ? "Since previous close"
      : change?.baseline.kind === "rolling"
        ? `Past ${change.baseline.duration_seconds / 3600} hours`
        : undefined;
  const chart = path(history, row.history?.presentation);
  const book = context?.top_of_book;
  const venueStatus = context?.venue_status;
  const detail = [
    series ? semantics(series) : "Price unavailable",
    timeLabel(observation?.time, format),
    basis,
    context?.reference_close
      ? `Change reference: ${context.reference_close.dataset} · ${timeLabel(context.reference_close.time, format)}`
      : undefined,
    context?.trade_size
      ? `Last trade: ${context.trade_size.value} ${context.trade_size.unit.kind}`
      : undefined,
    venueStatus
      ? `Venue status: ${venueStatus.code}${venueStatus.reason ? ` (${venueStatus.reason})` : ""} · ${timeLabel(venueStatus.time, format)}`
      : undefined,
    book ? `Bid/ask · ${timeLabel(book.time, format)}` : undefined,
    delayed
      ? delay !== undefined
        ? `${delay / 60} minute delay`
        : "Delayed; duration unreported"
      : undefined,
    history?.series ? `Chart: ${semantics(history.series)}` : undefined,
    ...(quote?.issues.map((issue) => issue.message) ?? []),
    ...(history?.issues.map((issue) => issue.message) ?? []),
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: bindingKey(row.subject),
    ticker: row.symbol || context?.symbol || "",
    name: row.name,
    price,
    unit:
      unit?.kind === "currency"
        ? unit.code
        : unit?.kind === "unknown"
          ? "?"
          : unit?.kind,
    status: !available
      ? "unavailable"
      : session === "closed"
        ? "closed"
        : delayed
          ? "delayed"
          : "unknown",
    activity: {
      session: session === "regular" ? "open" : (session ?? "unknown"),
      data: !available
        ? "unavailable"
        : delayed
          ? "delayed"
          : quote?.freshness.status === "stale"
            ? "stale"
            : quote?.freshness.status === "fresh"
              ? "current"
              : "unknown",
      ...(delay !== undefined && delay > 0 ? { delayMinutes: delay / 60 } : {}),
      ...(change?.baseline.kind === "previous_close"
        ? { period: "daily" as const }
        : change?.baseline.kind === "rolling" &&
            change.baseline.duration_seconds === 86400
          ? { period: "24h" as const }
          : {}),
    },
    statusLabel: !available
      ? "Price unavailable"
      : session === "continuous"
        ? "Trading 24/7"
        : session === "regular"
          ? "Market open"
          : session === "closed"
            ? "Market closed"
            : "Trading hours unknown",
    description: detail,
    ...(book
      ? {
          book: {
            bid: number(book.bid, unit?.scale),
            ask: number(book.ask, unit?.scale),
            bidSize: number(book.bid_size, book.size_unit.scale),
            askSize: number(book.ask_size, book.size_unit.scale),
            label: `${series?.venue ?? "Source"} bid/ask · sizes in ${book.size_unit.kind} · ${timeLabel(book.time, format)}`,
          },
        }
      : {}),
    ...(change
      ? {
          change: {
            absolute: number(change.absolute, unit?.scale),
            percent: number(change.percent),
            basis,
          },
        }
      : {}),
    ...(chart
      ? { path: chart }
      : { pathState: historyLoading ? "loading" : "unavailable" }),
  };
}
