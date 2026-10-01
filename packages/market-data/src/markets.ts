/**
 * Client side of core's markets overview reads
 * (runtime/managed/core/markets_ops.py): `market-overview` names the
 * overview's card and watchlist subjects, `market-movers` reads one market
 * movers list. Core owns both shapes; change this file together with core.
 */
import type { PluginTransport } from "@pythia/widget-sdk";
import { z } from "zod";
import { SUBJECT_PLUGIN } from "./subject";

const text = z.string().min(1);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value || null);
const issuesSchema = z
  .array(z.object({ code: z.string().optional(), message: z.string() }))
  .default([]);

export const MOVER_LISTS = ["most_active", "gainers", "losers"] as const;
export type MoverList = (typeof MOVER_LISTS)[number];

export const marketOverviewSchema = z.object({
  /** Each card's subject and the group it shows in ("US", "Rates & FX"). */
  cards: z.array(z.object({ subject: text, group: text })).default([]),
  watchlist: z.array(text).default([]),
  /** Names from core's curated tables, by subject ID, so a subject that
   * cannot be read still shows a name. */
  names: z.record(z.string(), text).default({}),
});
export type MarketOverview = z.infer<typeof marketOverviewSchema>;

/** One row as the source ranked it. `subject_id` is null when Pythia's
 * reference has no single listing for the row; `unresolved` says why. */
export const moverRowSchema = z.object({
  rank: z.number().int(),
  subject_id: text.nullish(),
  unresolved: optionalText,
  symbol: text,
  name: optionalText,
  currency: text,
  price: z.number(),
  change: z.number(),
  change_percent: z.number(),
  volume: z.number().nullish(),
  /** "pre" | "regular" | "post" | "closed" when the source says. */
  session: optionalText,
  /** The quote time of the row's regular-session values. */
  time: text,
  venue: optionalText,
});
export type MoverRow = z.infer<typeof moverRowSchema>;

const sourceSchema = z.object({ source: text, provider: text, plugin: text });
export const marketMoversSchema = z.object({
  list: text,
  /** The market the list ranks, as the source states it ("US"), and which of
   * its shares ("US stocks with a market cap of $2B or more"). */
  market: optionalText,
  universe: optionalText,
  source: sourceSchema.nullish(),
  retrieved_at: optionalText,
  rows: z.array(moverRowSchema).default([]),
});
export type MarketMovers = z.infer<typeof marketMoversSchema>;

const envelope = z.object({
  outcome: z.string(),
  data: z.unknown(),
  issues: issuesSchema,
});

export function marketQueryKey(operation: string, ...parts: unknown[]) {
  return ["plugin", SUBJECT_PLUGIN, operation, ...parts] as const;
}

export async function readMarketOverview(
  transport: Pick<PluginTransport, "read">,
  signal?: AbortSignal,
) {
  const value = envelope.parse(
    await transport.read(
      { plugin: SUBJECT_PLUGIN, operation: "market-overview", arguments: {} },
      signal,
    ),
  );
  return {
    overview: marketOverviewSchema.parse(value.data),
    issues: value.issues,
  };
}

/** One list with its issues. A failed source answers `error` with its name
 * and no rows; a changed source answers rows with a `source_drift` issue. */
export async function readMarketMovers(
  transport: Pick<PluginTransport, "read">,
  list: MoverList,
  limit: number,
  signal?: AbortSignal,
) {
  const value = envelope.parse(
    await transport.read(
      {
        plugin: SUBJECT_PLUGIN,
        operation: "market-movers",
        arguments: { list, limit },
      },
      signal,
    ),
  );
  return {
    outcome: value.outcome,
    movers: value.data == null ? null : marketMoversSchema.parse(value.data),
    issues: value.issues,
  };
}
