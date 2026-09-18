/** Display contract, not an identity database or a provider response. Adapters
 * preserve qualified identity, units, session evidence, baselines and freshness.
 * Canonical identity and matching belong to Pythia's financial backend. */
export type InstrumentStatus =
  | "live"
  | "delayed"
  | "extended"
  | "closed"
  | "halted"
  | "unavailable"
  | "unknown";
/** Market activity and observation quality are independent. An open market can
 * have stale data; a closed market can have a valid last-session snapshot. */
export type InstrumentActivity = {
  session:
    | "open"
    | "continuous"
    | "pre"
    | "post"
    | "closed"
    | "halted"
    | "unknown"
    | "not-applicable";
  data:
    | "current"
    | "delayed"
    | "snapshot"
    | "previous"
    | "stale"
    | "unknown"
    | "unavailable";
  delayMinutes?: number | undefined;
  /** Bounded comparison period, not prose or a provider name. */
  period?: "24h" | "7d" | "30d" | "daily" | undefined;
};
export type InstrumentPath = {
  /** A qualified current path may continue through extended hours. */
  live?: boolean | undefined;
  points: readonly { time: number; value: number }[];
  /** Explicit, qualified comparison baseline; its label preserves reference meaning. */
  baseline?: { value: number; label: string } | undefined;
  label: string;
  intervalMs?: number | undefined;
  /** Full scheduled session, including the part with no observations yet. */
  session?: { start: number; end: number } | undefined;
  /** Explicit horizontal time window; independent of asset or trading sessions.
   * Supply window or session, never both. Missing observations leave empty space. */
  window?: { start: number; end: number } | undefined;
  extendedFrom?: number | undefined;
  /** Regular hours inside the full session window; outside hours are subdued. */
  regularSession?: { start: number; end: number } | undefined;
  /** Omitted closed interval between a regular session and its continuation.
   * Observation timestamps remain unchanged; the axis skips this interval. */
  sessionGap?: { start: number; end: number } | undefined;
  period?: string | undefined;
};
export type InstrumentDisplay = {
  id: string;
  ticker: string;
  name?: string | undefined;
  price: number | null;
  precision?: number | undefined;
  unit?: string | undefined;
  priceSuffix?: string | undefined;
  priceLabel?: string | undefined;
  change?:
    | {
        absolute?: number | null | undefined;
        percent?: number | null | undefined;
        unit?: string | undefined;
        basis?: string | undefined;
      }
    | undefined;
  status: InstrumentStatus;
  /** Explicit header semantics. Legacy status remains the price/path fallback. */
  activity?: InstrumentActivity | undefined;
  statusLabel: string;
  note?: string | undefined;
  basisLabel?: string | undefined;
  /** Full provenance and observation time, exposed with the instrument label. */
  description: string;
  /** Optional venue-qualified book; price and size timestamps belong to label. */
  book?:
    | {
        bid: number | null;
        ask: number | null;
        bidSize: number | null;
        askSize: number | null;
        label: string;
      }
    | undefined;
  path?: InstrumentPath | undefined;
  pathState?: "loading" | "unavailable" | undefined;
  ohl?:
    | { open: number | null; high: number | null; low: number | null }
    | undefined;
  extended?: {
    label: string;
    price: number;
    percent?: number | undefined;
    absolute?: number | undefined;
    time: string;
  };
};
export type InstrumentWidgetOptions = {
  book?: boolean | undefined;
  name?: boolean | undefined;
  note?: boolean | undefined;
  unit?: boolean | undefined;
  change?: "percent" | "absolute" | "both" | undefined;
  path?: boolean | undefined;
  pathHeight?: number | undefined;
  range?: boolean | undefined;
  compact?: boolean | undefined;
};
export type InstrumentRead = {
  rows: readonly InstrumentDisplay[];
  state: "loading" | "ready" | "empty" | "error";
  message?: string | undefined;
};
