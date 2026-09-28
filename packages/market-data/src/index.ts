/** Portable v1 wire types. Runtime payloads require schema and semantic validation. */
export { default as marketDataSchema } from "../schema.json" with {
  type: "json",
};
export type Decimal = string;
export type Instant = string;
export type MarketDataType =
  | "realtime"
  | "delayed"
  | "frozen"
  | "delayed_frozen"
  | "eod"
  | "unknown";
/** Backbone subject levels (ADR 0037): the instrument kinds. */
export type SubjectLevel = "issuer" | "security" | "composite" | "listing";
/** A subject's kind: an instrument level or another kind (`index`, `fx`, ...),
 * passed through as text when this client does not know it. */
export type SubjectKind = SubjectLevel | (string & {});
/** A backbone subject: its deterministic subject ID (for example
 * `listing:isin:NL0010273215:XAMS:EUR`) and the kind that ID names. */
export interface Subject {
  kind: SubjectKind;
  id: string;
}
export interface Qualifiers {
  currency?: string;
  venue?: string;
  route?: string;
  share_class?: string;
  network?: string;
}
export interface ProviderRef {
  provider: string;
  native_id: string;
  native_scope: string;
  qualifiers?: Qualifiers;
}
export type Binding = Subject | ProviderRef;
export type ObservationTime =
  | { kind: "instant"; value: Instant }
  | { kind: "session_date"; value: string }
  | { kind: "unknown" };
export interface Window {
  start: ObservationTime | null;
  end: ObservationTime | null;
}
export type Unit =
  | { kind: "currency"; code: string; scale: Decimal }
  | {
      kind: "shares" | "count" | "ratio" | "percent" | "unknown";
      scale: Decimal;
    }
  | { kind: "asset"; asset: Binding; scale: Decimal };
export interface Adjustment {
  kind: "none" | "split" | "split_dividend" | "unknown";
  anchor: ObservationTime | null;
}
export interface Field {
  unit: Unit;
  adjustment: Adjustment;
}
export type Fields =
  | { value: Field }
  | { open: Field; high: Field; low: Field; close: Field; volume?: Field };
/** Flat bounded source facts, not a provider request/response proxy. */
export interface SourceDetail {
  namespace: string;
  values: Record<string, string | boolean | null>;
}
export interface Series {
  schema_version: 1;
  market_data_type: MarketDataType;
  id: string;
  subject: Binding;
  provider_ref: ProviderRef;
  measurement:
    | "last_trade"
    | "close"
    | "bid"
    | "ask"
    | "midpoint"
    | "aggregate_price"
    | "ohlc"
    | "count"
    | "ratio"
    | "percent";
  shape: "scalar" | "ohlc";
  fields: Fields;
  interval: {
    kind: "tick" | "day" | "minute" | "hour" | "unknown";
    count: number;
  };
  calendar: string | null;
  timezone: string | null;
  session: "regular" | "extended" | "all" | "unknown";
  time_anchor:
    | "instant"
    | "session_date"
    | "interval_start"
    | "interval_end"
    | "unknown";
  dataset: string;
  venue: string | null;
  route: string | null;
  methodology: { id: string; version: string } | null;
  source_detail: SourceDetail | null;
  read_support?: {
    operations: ("latest" | "history")[];
    window_kind: "instant" | "session_date";
    max_span_seconds?: number;
    updates?: "poll" | "push";
  };
}
export interface Completion {
  state: "open" | "completed" | "unknown";
  basis: "source" | "calendar" | "unknown";
}
interface ObservationBase {
  time: ObservationTime;
  interval: Window | null;
  completion: Completion;
}
export type Observation =
  | (ObservationBase & { shape: "scalar"; value: Decimal })
  | (ObservationBase & {
      shape: "ohlc";
      open: Decimal;
      high: Decimal;
      low: Decimal;
      close: Decimal;
      volume?: Decimal;
    });
export type View =
  | { kind: "pythia"; subject: Binding }
  | { kind: "source"; series_id: string };
export interface Requirements {
  freshness: "any" | "fresh";
  completion: "any" | "completed";
  coverage: "any" | "complete";
}
export interface ReadRequest {
  schema_version: 1;
  operation: "latest" | "history";
  view: View;
  window: Window;
  limit: number;
  requirements: Requirements;
}
export interface Issue {
  code: string;
  message: string;
  severity: "warning" | "error";
  source_code?: string;
  retry_after_seconds?: number;
  limit_origin?: "connector" | "provider";
}
export interface PriceContext {
  session_window?: {
    date: string;
    timezone: string;
    regular: { start: Instant; end: Instant };
    extended: { start: Instant; end: Instant };
    /** Before today's open: the last session, whose after-hours close
     * precedes today's pre-market by a closed interval. */
    previous?: {
      regular: { start: Instant; end: Instant };
      extended: { start: Instant; end: Instant };
    };
  };
  /** The latest pre- or post-market trade, compared with the last regular
   * close; the regular observation remains the series value. */
  extended?: {
    session: "pre" | "post";
    value: Decimal;
    time: ObservationTime;
    absolute?: Decimal;
    percent?: Decimal;
  };
  reference_close?: {
    value: Decimal;
    unit: Unit;
    time: ObservationTime;
    provider_ref: ProviderRef;
    dataset: string;
    retrieved_at: Instant;
  };
  top_of_book?: {
    bid: Decimal;
    ask: Decimal;
    bid_size: Decimal;
    ask_size: Decimal;
    size_unit: Unit;
    time: ObservationTime;
  };
  venue_status?: { code: string; reason: string; time: ObservationTime };
  trade_size?: { value: Decimal; unit: Unit };
  symbol?: string;
  name?: string;
  delay_seconds?: number;
  session?: {
    state: "regular" | "pre" | "post" | "closed" | "continuous" | "unknown";
    basis: "source" | "calendar" | "unknown";
  };
  change?: {
    baseline:
      | { kind: "previous_close"; time: ObservationTime }
      | { kind: "rolling"; duration_seconds: number; time: ObservationTime };
    absolute?: Decimal;
    percent?: Decimal;
  };
}
export interface Provenance {
  provider: string;
  native_ref: ProviderRef;
  adapter_version: string;
  retrieved_at: Instant;
  source_time: Instant | null;
  revision_vintage: string | null;
  source_detail: SourceDetail | null;
}
export interface Selection {
  view: View;
  reason:
    | "pinned"
    | "preference"
    | "unresolved"
    | "incompatible"
    | "disabled"
    | "unconfigured"
    | "unavailable";
  alternatives: string[];
}
export interface Coverage {
  status: "complete" | "partial" | "unknown";
  gaps: Window[];
  truncated: boolean;
  continuation: string | null;
}
export interface Freshness {
  status: "fresh" | "stale" | "unknown";
  as_of: Instant | null;
  basis: "source_time" | "calendar" | "unknown";
  market_data_type: MarketDataType;
}
export interface ReadResult {
  schema_version: 1;
  outcome: "ok" | "empty" | "partial" | "error";
  request: ReadRequest;
  series: Series | null;
  observations: Observation[];
  selection: Selection;
  provenance: Provenance | null;
  retrieved_at: Instant;
  returned_window: Window;
  coverage: Coverage;
  freshness: Freshness;
  requirements_satisfied: boolean;
  issues: Issue[];
  price_context?: PriceContext;
}
export interface ReadCriteria {
  measurement?: Series["measurement"];
  interval?: Series["interval"];
  session?: Series["session"];
  price_adjustment?: Adjustment["kind"];
  market_data_type?: MarketDataType;
  currency?: string;
  venue?: string;
  route?: string;
}
export interface ReadInput {
  request: ReadRequest;
  criteria?: ReadCriteria;
  series?: Series;
}
export interface Contribution {
  schema_version: 1;
  provider: string;
  adapter_version: string;
  operations: {
    operation: "details" | "series" | "latest" | "history" | "read_batch";
    tool: string;
    effect: "read";
  }[];
  requires_broker_app?: boolean;
  observation_cache?: "default" | "disabled";
  cadence?: Partial<Record<"latest" | "history" | "series", number>>;
}
export interface WireTypes {
  subject: Subject;
  provider_ref: ProviderRef;
  series: Series;
  observation: Observation;
  read_request: ReadRequest;
  read_result: ReadResult;
  contribution: Contribution;
}
