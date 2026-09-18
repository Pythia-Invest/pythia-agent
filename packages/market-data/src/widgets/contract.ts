import { z } from "zod";
import { marketDataSchema as wire } from "../index";
import type {
  ReadCriteria,
  ReadInput,
  ReadResult,
  Series,
  Subject,
} from "../index";

/** Shape validation comes from the financial owner. Its Python reader also
 * enforces financial invariants before any result reaches Desk. */
function shape<T>(kind: keyof typeof wire.$defs) {
  return z.fromJSONSchema({ ...wire, $ref: `#/$defs/${kind}` } as Parameters<
    typeof z.fromJSONSchema
  >[0]) as z.ZodType<T>;
}
export const subjectSchema = shape<Subject>("subject");
export const seriesSchema = shape<Series>("series");
export const readResultSchema = shape<ReadResult>("read_result");
export const criteriaSchema = z
  .object({
    measurement: z
      .enum([
        "last_trade",
        "close",
        "bid",
        "ask",
        "midpoint",
        "aggregate_price",
        "ohlc",
        "count",
        "ratio",
        "percent",
      ])
      .optional(),
    interval: z
      .object({
        kind: z.enum(["tick", "day", "minute", "hour", "unknown"]),
        count: z.number().int().positive(),
      })
      .strict()
      .optional(),
    session: z.enum(["regular", "extended", "all", "unknown"]).optional(),
    price_adjustment: z
      .enum(["none", "split", "split_dividend", "unknown"])
      .optional(),
    market_data_type: z
      .enum([
        "realtime",
        "delayed",
        "frozen",
        "delayed_frozen",
        "eod",
        "unknown",
      ])
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    venue: z.string().min(1).max(512).optional(),
    route: z.string().min(1).max(512).optional(),
  })
  .strict() as z.ZodType<ReadCriteria>;
export const readInputSchema = z
  .object({
    request: shape<ReadInput["request"]>("read_request"),
    criteria: criteriaSchema.optional(),
    series: seriesSchema.optional(),
  })
  .strict()
  .transform(
    (value): ReadInput => ({
      request: value.request,
      ...(value.criteria !== undefined ? { criteria: value.criteria } : {}),
      ...(value.series !== undefined ? { series: value.series } : {}),
    }),
  );
export const financialRequestSchema = z
  .object({ reads: z.array(readInputSchema).min(1).max(32) })
  .strict();

const selection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preferred"), criteria: criteriaSchema }).strict(),
  z.object({ mode: z.literal("pinned"), series: seriesSchema }).strict(),
]);
export const financialSourceSchema = z
  .object({
    feed: z.literal("prices"),
    subjects: z
      .array(
        z
          .object({
            subject: subjectSchema,
            symbol: z.string().max(64),
            name: z.string().min(1).max(256),
            price: selection,
            history: z
              .object({
                selection,
                window: z
                  .object({
                    kind: z.enum(["rolling", "sessions"]),
                    days: z.number().int().min(1).max(90),
                  })
                  .strict(),
                completion: z.enum(["any", "completed"]).default("any"),
                presentation: z.enum(["session", "window"]).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict()
  .superRefine((source, ctx) => {
    const ids = source.subjects.map((row) => row.subject.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Use each canonical subject once in a list.",
      });
    for (const row of source.subjects) {
      for (const selected of [row.price, row.history?.selection]) {
        if (
          selected?.mode === "pinned" &&
          (!("kind" in selected.series.subject) ||
            selected.series.subject.kind !== row.subject.kind ||
            selected.series.subject.id !== row.subject.id)
        )
          ctx.addIssue({
            code: "custom",
            message: "Pin the full series returned for this canonical subject.",
          });
      }
    }
  });
export type FinancialSource = z.infer<typeof financialSourceSchema>;
export type FinancialRow = FinancialSource["subjects"][number];
export type FinancialRead = { result: ReadResult; refreshAfterSeconds: number };

export function financialQueryKey(
  row: FinancialRow,
  operation: "latest" | "history",
) {
  return [
    "financial-read",
    row.subject,
    operation,
    operation === "latest" ? row.price : row.history?.selection,
    operation === "history" && row.history
      ? {
          selection: row.history.selection,
          window: row.history.window,
          completion: row.history.completion,
        }
      : null,
  ];
}

export function financialInput(
  row: FinancialRow,
  operation: "latest" | "history",
  now: number,
): ReadInput | undefined {
  const selected = operation === "latest" ? row.price : row.history?.selection;
  if (!selected) return undefined;
  let window: ReadInput["request"]["window"] = { start: null, end: null };
  if (operation === "history" && row.history) {
    // Rolling endpoints move on a minute boundary, so different widgets share
    // identical windows. Session dates remain dates in requests and results.
    const end = Math.floor(now / 60_000) * 60_000;
    const start = end - row.history.window.days * 86_400_000;
    const sessions = row.history.window.kind === "sessions";
    const edge = (stamp: number) =>
      sessions
        ? {
            kind: "session_date" as const,
            value: new Date(stamp).toISOString().slice(0, 10),
          }
        : { kind: "instant" as const, value: new Date(stamp).toISOString() };
    window = { start: edge(start), end: edge(end) };
  }
  return {
    request: {
      schema_version: 1,
      operation,
      view:
        selected.mode === "preferred"
          ? { kind: "pythia", subject: row.subject }
          : { kind: "source", series_id: selected.series.id },
      window,
      limit: operation === "latest" ? 1 : 2000,
      requirements: {
        freshness: "any",
        completion:
          operation === "history" ? (row.history?.completion ?? "any") : "any",
        coverage: "any",
      },
    },
    ...(selected.mode === "preferred"
      ? { criteria: selected.criteria }
      : { series: selected.series }),
  };
}
