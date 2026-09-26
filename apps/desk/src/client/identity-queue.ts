"use client";
import { SUBJECT_PLUGIN, subjectQueryKey } from "@pythia/market-data/subject";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { busyRetry } from "./busy-retry";
import { useDeskApi } from "./providers";

/*
 * Client side of core's resolution queue: `identity-queue` lists a subject's
 * open identity questions and `identity-verdict` answers one. Core owns both
 * shapes and decides who answers from the transport: a Desk call is the
 * user's own attestation, still refused when identifier evidence contradicts
 * it. Answering is optional; the agent and rules work the same queue.
 */

const text = z.string().min(1);

export const identityQuestionSchema = z.object({
  id: text,
  kind: text,
  reason: text,
  label: text,
  question: text,
  candidate_ids: z.array(text).default([]),
  answers: z
    .array(z.object({ relation: text, chosen_id: z.string().nullable() }))
    .default([]),
});
export type IdentityQuestion = z.infer<typeof identityQuestionSchema>;

const listSchema = z.object({
  data: z
    .object({ items: z.array(identityQuestionSchema).default([]) })
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

function questionsKey(subjectId: string) {
  return ["plugin", SUBJECT_PLUGIN, "identity-queue", subjectId] as const;
}

/** Open identity questions about one subject and its listing, security and
 * issuer; read only while the page reports any. */
export function useIdentityQuestions(subjectId: string, enabled: boolean) {
  const api = useDeskApi();
  return useQuery({
    queryKey: questionsKey(subjectId),
    queryFn: async () =>
      listSchema.parse(
        await api.pluginRead({
          plugin: SUBJECT_PLUGIN,
          operation: "identity-queue",
          arguments: { subject_id: subjectId },
        }),
      ).data?.items ?? [],
    enabled,
    ...busyRetry,
  });
}

/** The user's answer to one question; the page recomposes afterwards. */
export function useAnswerQuestion(subjectId: string) {
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
        client.invalidateQueries({ queryKey: questionsKey(subjectId) }),
        client.invalidateQueries({ queryKey: subjectQueryKey(subjectId) }),
      ]),
    retry: false,
  });
}
