/** A native operation descriptor. The backend still validates ownership,
 * enablement, read-only support, arguments, and domain meaning. */
export type WidgetDataResource = {
  plugin: string;
  operation: string;
  arguments: Record<string, unknown>;
  window?: Record<string, unknown>;
};

export type WidgetQuery<Result = unknown> = {
  key: readonly unknown[];
  resource: WidgetDataResource;
  /** Fresh arguments for an explicit retry; Desk performs the protected read. */
  readResource?(): Pick<
    WidgetDataResource,
    "plugin" | "operation" | "arguments"
  >;
  enabled: boolean;
  decode(value: unknown): Result;
  reconcile?(previous: Result | undefined, next: Result): Result;
};

export type WidgetQueryResult<Result = unknown> = {
  data?: Result | undefined;
  error: unknown;
  isPending: boolean;
};

export type TimestampFormatter = (
  value: string | number | null | undefined,
  style?: "compact" | "full" | "time",
) => string;

export type WidgetBindingContext = { formatTimestamp: TimestampFormatter };

/** Optional pure feature adapter. Desk coordinates the declared requests and
 * subscriptions; feature code owns request meaning, decoding, and display data.
 * No fetch callback, provider, timer, or credential is supplied to this adapter. */
export type WidgetBinding<Input = unknown, Result = unknown, Data = unknown> = {
  queries(input: Input): WidgetQuery<Result>[];
  deferred?(
    input: Input,
    primary: WidgetQueryResult<Result>[],
  ): WidgetQuery<Result>[];
  render(
    input: Input,
    primary: WidgetQueryResult<Result>[],
    deferred: WidgetQueryResult<Result>[],
    context: WidgetBindingContext,
  ): {
    data: Data;
    state: "loading" | "ready" | "empty" | "error";
    message?: string;
  };
};
