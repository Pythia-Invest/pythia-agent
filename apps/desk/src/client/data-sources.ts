"use client";
import { coreData, SUBJECT_PLUGIN } from "@pythia/market-data/subject";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { busyRetry } from "./busy-retry";
import { useDeskApi } from "./providers";
import { deskKeys } from "./query-cache";

/*
 * Core's data sources: `identity-plugin-effect` lists each plugin Hermes has
 * enabled that ships a contract, with its trust level, what it serves, whether
 * the investor paused it, and what pausing it hides (ADR 0044 A3);
 * `identity-sync` reads one plugin's catalogue into the device's identity store
 * when the user asks. Pausing is Pythia's own switch, kept in its settings and
 * applied at once; enabling a plugin Hermes does not run stays Hermes's command.
 */

const text = z.string().min(1);
const sample = z.object({ id: text, name: z.string().nullish() });

export const dataSourceSchema = z.object({
  plugin: text,
  label: text,
  /** display: shown with its source; confirm: establishes identity facts. */
  level: z.enum(["display", "confirm"]).catch("display"),
  catalogue: z.boolean(),
  resolve: z.boolean(),
  /** The data concepts it serves (`market_data`, `filings`, `news` ...). */
  serves: z.array(z.string()).default([]),
  /** The investor turned it off here: its data is out of selection, search,
   * pages and ingest, and its subjects and saved entries keep their names. */
  paused: z.boolean().default(false),
  /** The device subjects only this plugin supplies. */
  sole: z.object({ count: z.number().int(), sample: z.array(sample) }),
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
  not_seen: z.number().int().default(0),
  partial: z.boolean().default(false),
});
export type SyncSummary = z.infer<typeof syncSchema>;

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
