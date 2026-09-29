"use client";
import { coreData, SUBJECT_PLUGIN } from "@pythia/market-data/subject";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { busyRetry } from "./busy-retry";
import { useDeskApi } from "./providers";

/*
 * Client side of core's resolution queue: `identity-queue` lists the open
 * identity questions and `identity-verdict` answers one. Core owns both
 * shapes and decides who answers from the transport: a Desk call is the
 * user's own attestation, still refused when identifier evidence contradicts
 * it. Answering is optional; rules, and the agent when asked, work the same
 * queue.
 */

const text = z.string().min(1);

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value || null);

const subject = z.object({
  id: text,
  /** Its kind: listing, security, issuer or another. */
  level: optionalText,
  /** False for a subject the reference does not know, such as the record's
   * own provisional one. */
  known: z.boolean().default(true),
  name: optionalText,
  identifiers: z.record(z.string(), optionalText).default({}),
});

export const identityQuestionSchema = z.object({
  id: text,
  kind: text,
  reason: text,
  label: text,
  question: text,
  state: text,
  opened_at: text,
  /** When a settled question was last changed: its resolution time. */
  updated_at: optionalText,
  /** Who settled it: rules, the agent or the user. */
  settled_by: optionalText,
  plugins: z.array(text).default([]),
  /** What the provider's record says, shown before anyone answers. */
  record: z
    .object({
      native_ref: z.object({ native_id: text }).nullish(),
      identifiers: z.array(z.object({ scheme: text, value: text })).default([]),
      name: optionalText,
      ticker: optionalText,
      mic: optionalText,
      currency: optionalText,
    })
    .nullish(),
  /** What the question is about: the record's own subject or, for a record
   * bound elsewhere, that instrument too. */
  subjects: z.array(subject).default([]),
  candidates: z.array(subject).default([]),
  /** The reference assertions the question cites. */
  evidence: z
    .array(z.object({ scheme: text, value: text, source: optionalText }))
    .default([]),
  /** On an open question: the agent's suggestion, waiting for the user. */
  agent_answer: z
    .object({ relation: text, chosen_id: z.string().nullable() })
    .nullish(),
  candidate_ids: z.array(text).default([]),
  answers: z
    .array(z.object({ relation: text, chosen_id: z.string().nullable() }))
    .default([]),
});
export type IdentityQuestion = z.infer<typeof identityQuestionSchema>;

const listSchema = z.object({
  items: z.array(identityQuestionSchema).default([]),
  settled: z.array(identityQuestionSchema).default([]),
  /** Once per runtime: an older identity store was kept aside. */
  notice: z.string().nullish(),
});

const verdictSchema = z.object({
  outcome: text,
  state: z.string().optional(),
  message: text,
});
export type IdentityVerdict = z.infer<typeof verdictSchema>;

const questionsKey = ["plugin", SUBJECT_PLUGIN, "identity-queue"] as const;

/** The device's identity questions: open ones and, apart from them, those
 * rules or the user settled. The queue op caps each list at 50. A queue core could not read throws with its
 * reason, never reads as empty. */
export function useIdentityQuestions() {
  const api = useDeskApi();
  return useQuery({
    queryKey: questionsKey,
    queryFn: async () =>
      coreData(
        await api.pluginRead({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-queue",
          arguments: { settled: true, limit: 50 },
        }),
        listSchema,
      ),
    ...busyRetry,
  });
}

/** The user's answer to one question; instrument pages recompose afterwards. */
export function useAnswerQuestion() {
  const api = useDeskApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (answer: {
      itemId: string;
      relation: string;
      chosenId: string | null;
      /** Recorded with the verdict. */
      note?: string;
    }) =>
      coreData(
        await api.pluginInvoke({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-verdict",
          arguments: {
            item_id: answer.itemId,
            relation: answer.relation,
            ...(answer.chosenId ? { chosen_id: answer.chosenId } : {}),
            ...(answer.note ? { rationale: answer.note } : {}),
          },
        }),
        verdictSchema,
      ),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: questionsKey }),
        client.invalidateQueries({
          queryKey: ["plugin", SUBJECT_PLUGIN, "identity-subject"],
        }),
      ]),
    retry: false,
  });
}
