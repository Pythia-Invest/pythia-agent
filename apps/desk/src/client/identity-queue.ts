"use client";
import { SUBJECT_PLUGIN } from "@pythia/market-data/subject";
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

export const identityQuestionSchema = z.object({
  id: text,
  kind: text,
  reason: text,
  label: text,
  question: text,
  state: text,
  opened_at: text,
  plugins: z.array(text).default([]),
  /** What the provider's record says, shown before anyone answers. */
  record: z
    .object({
      native_ref: z.object({ native_id: text }).nullish(),
      name: optionalText,
      ticker: optionalText,
      mic: optionalText,
      currency: optionalText,
    })
    .nullish(),
  candidates: z.array(z.object({ id: text, name: optionalText })).default([]),
  /** Set when only the agent answered: provisional, the user may override. */
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
  data: z
    .object({
      items: z.array(identityQuestionSchema).default([]),
      answered: z.array(identityQuestionSchema).default([]),
      /** Once per runtime: an older identity store was kept aside. */
      notice: z.string().nullish(),
    })
    .nullish(),
});

const verdictSchema = z.object({
  data: z.object({
    outcome: text,
    state: z.string().optional(),
    message: text,
  }),
});
export type IdentityVerdict = z.infer<typeof verdictSchema>["data"];

const questionsKey = ["plugin", SUBJECT_PLUGIN, "identity-queue"] as const;

/** The device's open identity questions and, apart from them, those only the
 * agent answered (provisional). The queue op caps a list at 50. */
export function useIdentityQuestions() {
  const api = useDeskApi();
  return useQuery({
    queryKey: questionsKey,
    queryFn: async () =>
      listSchema.parse(
        await api.pluginRead({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-queue",
          arguments: { answered: true, limit: 50 },
        }),
      ).data ?? { items: [], answered: [] },
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
    }) =>
      verdictSchema.parse(
        await api.pluginInvoke({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-verdict",
          arguments: {
            item_id: answer.itemId,
            relation: answer.relation,
            ...(answer.chosenId ? { chosen_id: answer.chosenId } : {}),
          },
        }),
      ).data,
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
