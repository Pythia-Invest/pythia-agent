"use client";
import {
  coreData,
  correctionViewSchema,
  SUBJECT_PLUGIN,
} from "@pythia/market-data/subject";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { busyRetry } from "./busy-retry";
import { useDeskApi } from "./providers";

/*
 * Client side of core's catalogue corrections: `identity-corrections` lists
 * them for Repairs and `identity-correction` writes one. Core owns both shapes
 * and decides who writes from the transport: a Desk call is the investor's own
 * correction and applies at once; confirming an agent's proposal, declining
 * it and undoing a correction are Desk-only actions.
 */

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value || null);

export const correctionSchema = correctionViewSchema.extend({
  proposed_by: optionalText,
  note: optionalText,
  created_at: z.string().min(1),
  decided_at: optionalText,
  ended_at: optionalText,
  /** The subject's name, and for a pin the source's label. */
  name: optionalText,
  label: optionalText,
});
export type Correction = z.infer<typeof correctionSchema>;

const listSchema = z.object({ items: z.array(correctionSchema).default([]) });
const resultSchema = z.object({
  outcome: z.string().min(1),
  message: z.string().min(1),
  warning: z.string().nullish(),
});

/** What one write asks of core; `value` empty removes an identifier. */
export type CorrectionRequest =
  | {
      action?: "set";
      kind: "identifier" | "price_source";
      subjectId: string;
      scheme?: string;
      value: string;
      note?: string;
    }
  | { action: "confirm" | "decline" | "undo"; id: string; note?: string };

/** Runs one write; resolves to the message to show, or throws with the
 * reason core refused it. */
export type CorrectFn = (request: CorrectionRequest) => Promise<string>;

const correctionsKey = [
  "plugin",
  SUBJECT_PLUGIN,
  "identity-corrections",
] as const;

/** Every correction and proposal on this device, newest first. */
export function useCorrections() {
  const api = useDeskApi();
  return useQuery({
    queryKey: correctionsKey,
    queryFn: async () =>
      coreData(
        await api.pluginRead({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-corrections",
          arguments: { limit: 50 },
        }),
        listSchema,
      ).items,
    ...busyRetry,
  });
}

/** The investor's write; instrument pages recompose afterwards, since a
 * correction changes what they show and which source prices them. */
export function useCorrect(): CorrectFn {
  const api = useDeskApi();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (request: CorrectionRequest) => {
      const result = coreData(
        await api.pluginInvoke({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-correction",
          arguments:
            "id" in request
              ? { action: request.action, id: request.id, note: request.note }
              : {
                  kind: request.kind,
                  subject_id: request.subjectId,
                  scheme: request.scheme,
                  value: request.value,
                  note: request.note,
                },
        }),
        resultSchema,
      );
      if (result.outcome === "refused") throw new Error(result.message);
      return result.warning
        ? `${result.message} ${result.warning}`
        : result.message;
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: correctionsKey }),
        client.invalidateQueries({
          queryKey: ["plugin", SUBJECT_PLUGIN, "identity-subject"],
        }),
      ]),
    retry: false,
  });
  return mutation.mutateAsync;
}
