"use client";
import { searchQueryKey } from "@pythia/market-data/search-ui";
import { coreData, SUBJECT_PLUGIN } from "@pythia/market-data/subject";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { busyRetry } from "./busy-retry";
import { useDeskApi } from "./providers";
import { deskKeys } from "./query-cache";

/*
 * Core's data sources: `identity-plugin-effect` lists each plugin Hermes has
 * enabled that ships a contract, with what it serves, whether
 * the investor paused it, and what pausing it hides (ADR 0044 A3);
 * `identity-sync` reads one plugin's catalogue into the device's identity store
 * when the user asks, and `identity-lookup` looks one identifier up in one
 * plugin's resolve and stores what it answers: a plugin's own function, on its
 * own row here, never part of search. Pausing is Pythia's own switch, kept in its settings and
 * applied at once; enabling a plugin Hermes does not run stays Hermes's command.
 */

const text = z.string().min(1);
const sample = z.object({ id: text, name: z.string().nullish() });

export const dataSourceSchema = z.object({
  plugin: text,
  label: text,
  catalogue: z.boolean(),
  /** The identifier schemes its resolve takes (`isin`, `figi` ...): what the
   * investor can look up in it. Empty when it has no resolve. */
  lookup: z.array(z.string()).default([]),
  /** The data concepts it serves (`market_data`, `filings`, `news` ...). */
  serves: z.array(z.string()).default([]),
  /** The investor turned it off here: its data is out of selection, search,
   * pages and ingest, and its subjects and saved entries keep their names. */
  paused: z.boolean().default(false),
  /** The device subjects only this plugin supplies. */
  sole: z.object({ count: z.number().int(), sample: z.array(sample) }),
  /** The identifiers it states on subjects that stay (the package's, or
   * another source's) and no other source or the package states too: they
   * leave those subjects while it is off. */
  stated: z
    .object({ count: z.number().int(), subjects: z.number().int() })
    .default({ count: 0, subjects: 0 }),
  /** The saved watchlist and card entries that name them. */
  saved: z.object({
    count: z.number().int(),
    sample: z.array(sample.extend({ setting: text })),
  }),
});
export type DataSource = z.infer<typeof dataSourceSchema>;

const listSchema = z.object({ plugins: z.array(dataSourceSchema) });

export const syncSchema = z.object({
  joined: z.number().int(),
  introduced: z.number().int(),
  conflicts: z.number().int(),
  unmatched: z.number().int(),
  /** Records core refused; a lookup's answer can be all of them. */
  rejected: z.number().int().default(0),
  not_seen: z.number().int().default(0),
  partial: z.boolean().default(false),
});
export type SyncSummary = z.infer<typeof syncSchema>;

/** What one lookup stored: the counts of a sync, and the subjects placed. */
export const lookupSchema = syncSchema.extend({
  subjects: z.array(z.string()),
});
export type LookupSummary = z.infer<typeof lookupSchema>;

export function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

/** How a read's records were placed, in the investor's words. */
export function placedLine(summary: SyncSummary) {
  return [
    `${summary.joined} joined`,
    `${summary.introduced} new`,
    count(summary.conflicts, "conflict", "conflicts"),
    `${summary.unmatched} unmatched`,
    ...(summary.rejected ? [`${summary.rejected} rejected`] : []),
    ...(summary.not_seen ? [`${summary.not_seen} no longer offered`] : []),
  ].join(", ");
}

const lookupAnswer = z.object({
  data: lookupSchema.nullish(),
  issues: z.array(z.object({ message: z.string() })).default([]),
});

const syncAnswer = z.object({
  data: syncSchema.nullish(),
  issues: z.array(z.object({ message: z.string() })).default([]),
});

const sourcesKey = [
  "plugin",
  SUBJECT_PLUGIN,
  "identity-plugin-effect",
] as const;

export function useDataSources() {
  const api = useDeskApi();
  return useQuery({
    queryKey: sourcesKey,
    queryFn: async () =>
      coreData(
        await api.pluginRead({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-plugin-effect",
          arguments: {},
        }),
        listSchema,
      ).plugins,
    ...busyRetry,
  });
}

/** Reads one plugin's catalogue now. A sync the source stopped still answers
 * what it placed, with the reason; one core refused answers only the reason. */
export function useSyncSource() {
  const api = useDeskApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (plugin: string) => {
      const answer = syncAnswer.parse(
        await api.pluginInvoke({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-sync",
          arguments: { plugin },
        }),
      );
      if (!answer.data)
        throw Error(answer.issues[0]?.message ?? "The catalogue was not read.");
      return { summary: answer.data, issue: answer.issues[0]?.message ?? null };
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: sourcesKey }),
        client.invalidateQueries({
          queryKey: ["plugin", SUBJECT_PLUGIN, "identity-subject"],
        }),
      ]),
    retry: false,
  });
}

/** Looks one identifier up in one plugin now. "No match" is an answer (all
 * counts zero, with the reason); a refusal or failure answers only the reason. */
export function useLookupSource() {
  const api = useDeskApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (request: { plugin: string; query: string }) => {
      const answer = lookupAnswer.parse(
        await api.pluginInvoke({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-lookup",
          arguments: request,
        }),
      );
      if (!answer.data)
        throw Error(answer.issues[0]?.message ?? "The lookup failed.");
      return { summary: answer.data, issue: answer.issues[0]?.message ?? null };
    },
    // What it stored can change search, pages and this row's counts.
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: sourcesKey }),
        client.invalidateQueries({ queryKey: searchQueryKey }),
        client.invalidateQueries({
          queryKey: ["plugin", SUBJECT_PLUGIN, "identity-subject"],
        }),
      ]),
    retry: false,
  });
}

/** Pauses or resumes one source in Pythia's own settings. Core reads the
 * setting on every use, so nothing restarts: every plugin read (search,
 * pages, prices, lists) is asked again. */
export function usePauseSource() {
  const api = useDeskApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: { plugin: string; paused: boolean }) =>
      api.setPluginPaused(change.plugin, change.paused),
    onSettled: () => client.invalidateQueries({ queryKey: deskKeys.plugins }),
    retry: false,
  });
}
