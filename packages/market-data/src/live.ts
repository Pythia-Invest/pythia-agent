/**
 * Client side of core's `live_market` snapshot, schema version 1 (ADR 0040):
 * `runtime/managed/core/identity/live_market.py` owns the shape and validates
 * every snapshot before publication; this file mirrors it, change it together
 * with core. One shape for every provider, so a view never learns the venue:
 * a 5-level signed perp book with funding (Hyperliquid) and a one-level,
 * unsigned single-venue stock feed with session context decode alike.
 *
 * Times are epoch milliseconds. Prices and sizes stay decimal strings as the
 * provider sent them; a part the source does not send is absent.
 */
import { z } from "zod";

const time = z.number().int().min(1e12).max(1e14);
const decimal = z.string().regex(/^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/);
const level = z.union([
  z.tuple([decimal, decimal]),
  z.tuple([decimal, decimal, z.number().int().min(0)]),
]);
const issue = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]).optional(),
  message: z.string().optional(),
});

const perp = z.object({
  kind: z.literal("perp"),
  time,
  mark: decimal.optional(),
  oracle: decimal.optional(),
  mid: decimal.optional(),
  funding: z
    .object({ rate_1h: decimal, next_time: time.optional() })
    .optional(),
  open_interest: decimal.optional(),
  prev_day: decimal.optional(),
  day_volume: decimal.optional(),
});
const equitySession = z.object({
  kind: z.literal("equity_session"),
  time,
  session: z.enum(["pre", "regular", "post", "closed"]).optional(),
  venue_status: z
    .enum(["trading", "halted", "auction", "closed", "unknown"])
    .optional(),
  reference_close: z
    .object({
      value: decimal,
      time,
      dataset: z.string(),
      market_data_type: z.string(),
    })
    .optional(),
  change: z.object({ absolute: decimal, percent: decimal }).optional(),
});

export const liveMarketSchema = z.object({
  schema_version: z.literal(1),
  subject: z.object({ subject_id: z.string() }),
  source: z.object({
    plugin: z.string(),
    venue: z.string(),
    scope: z.enum(["venue", "consolidated"]),
    market_data_type: z.string(),
    delay_seconds: z.number().int().min(0).optional(),
  }),
  book: z
    .object({
      time,
      depth: z.enum(["top", "snapshot"]),
      unit: z.object({
        kind: z.enum(["coin", "shares", "contracts", "unknown"]),
        code: z.string().optional(),
      }),
      grouping: z
        .object({ n_sig_figs: z.number().optional(), tick: decimal.optional() })
        .optional(),
      bids: z.array(level).max(100),
      asks: z.array(level).max(100),
    })
    .optional(),
  trades: z
    .object({
      items: z
        .array(
          z.tuple([time, decimal, decimal, z.enum(["buy", "sell"]).nullable()]),
        )
        .max(200),
      dropped: z.number().int().min(0),
    })
    .optional(),
  line: z
    .object({
      measure: z.enum(["last_trade", "mid", "mark"]),
      bucket_ms: z.number().int(),
      points: z.array(z.tuple([time, decimal])).max(3600),
      seeded_from: z.string().optional(),
    })
    .optional(),
  context: z.discriminatedUnion("kind", [perp, equitySession]).optional(),
  gaps: z.array(z.object({ start: time, end: time })).max(100),
  issues: z.array(issue).max(20),
  retrieved_at: time,
});
export type LiveMarket = z.infer<typeof liveMarketSchema>;

/** Decodes one published answer: the standard envelope around a snapshot.
 * An error answer throws with its first issue's message. */
export function parseLiveMarket(value: unknown): LiveMarket {
  const envelope = z
    .object({
      outcome: z.string().optional(),
      data: z.unknown(),
      issues: z.array(z.object({ message: z.string().optional() })).optional(),
    })
    .parse(value);
  if (envelope.data === null || envelope.data === undefined)
    throw Error(
      envelope.issues?.[0]?.message ?? "No live snapshot was published.",
    );
  return liveMarketSchema.parse(envelope.data);
}
