"use client";
import { coreData, SUBJECT_PLUGIN } from "@pythia/market-data/subject";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { busyRetry } from "./busy-retry";
import { useDeskApi } from "./providers";

/*
 * Core's data sources: `identity-plugin-effect` lists each enabled plugin that
 * reads a catalogue or looks identifiers up, with what disabling it would
 * take away (ADR 0044 A3); `identity-sync` reads one
 * plugin's catalogue into the device's identity store when the user asks.
 * Enabling and disabling stay Hermes's own command.
 */

const text = z.string().min(1);
const sample = z.object({ id: text, name: z.string().nullish() });

export const dataSourceSchema = z.object({
  plugin: text,
  label: text,
  catalogue: z.boolean(),
  resolve: z.boolean(),
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
