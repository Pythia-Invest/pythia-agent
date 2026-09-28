"use client";
import {
  type IdentityQuestion,
  useAnswerQuestion,
} from "@/client/identity-queue";
import type { IdentityRepair } from "@/client/repairs";
import type { RepairAction, RepairKind } from "./kinds";

const SCHEMES: Record<string, string> = {
  isin: "ISIN",
  lei: "LEI",
  cik: "CIK",
  figi: "FIGI",
  share_class_figi: "Share-class FIGI",
  composite_figi: "Composite FIGI",
  caip19: "CAIP-19",
  ticker_mic: "Ticker",
};
const SETTLED_BY: Record<string, string> = {
  rules: "Rules",
  agent: "The agent (provisional)",
  user: "You",
};
/** A verdict that took effect; anything else keeps the dialog open with its reason. */
const TAKEN = new Set(["confirmed", "no_match"]);

function joined(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ") || "—";
}

function same(item: IdentityQuestion) {
  return item.answers.find(
    (entry) => entry.chosen_id && entry.relation.startsWith("same_"),
  );
}

function notThis(item: IdentityQuestion) {
  return item.answers.find((entry) => entry.relation === "unrelated");
}

/** Identity questions: the provider's record beside our instrument, the
 * evidence, and the user's answer recorded with an optional note. */
export function useIdentityKind(): RepairKind<IdentityQuestion> {
  const answer = useAnswerQuestion();
  const verdict =
    (item: IdentityQuestion, relation: string, chosenId: string | null) =>
    async (note: string) => {
      const result = await answer.mutateAsync({
        itemId: item.id,
        relation,
        chosenId,
        note,
      });
      if (!TAKEN.has(result.outcome)) throw new Error(result.message);
      return result.message;
    };
  const match = (item: IdentityQuestion, label: string): RepairAction[] => {
    const entry = same(item);
    return entry
      ? [
          {
            label,
            emphasis: "primary",
            dialog: {
              title: "Same instrument",
              description: `Bind ${item.label}'s record to this instrument. Identifier evidence against it refuses the answer.`,
              noteLabel: "Note",
              notePlaceholder: "Why this record is this instrument…",
              confirmLabel: "Confirm match",
              tone: "primary",
            },
            run: verdict(item, entry.relation, entry.chosen_id),
          },
        ]
      : [];
  };
  const dismiss = (item: IdentityQuestion, label: string): RepairAction[] => {
    const entry = notThis(item);
    return entry
      ? [
          {
            label,
            emphasis: "secondary",
            dialog: {
              title: "Not this instrument",
              description: `Record that ${item.label}'s record is a different instrument; its section then shows no match.`,
              noteLabel: "Reason",
              notePlaceholder: "Why this record is another instrument…",
              confirmLabel: "Not this instrument",
              tone: "danger",
            },
            run: verdict(item, entry.relation, entry.chosen_id),
          },
        ]
      : [];
  };
  return {
    label: "Identity question",
    context: ({ data: item }: IdentityRepair) => {
      const record = item.record;
      const candidate = item.candidates[0];
      const ids = candidate?.identifiers ?? {};
      return [
        { label: "Issue", value: item.question },
        {
          label: `${item.label} record`,
          value: joined(record?.name, record?.native_ref?.native_id),
        },
        {
          label: "Record venue · currency",
          value: joined(record?.mic, record?.currency),
        },
        {
          label: "Record identifiers",
          value: joined(
            ...(record?.identifiers ?? []).map(
              (entry) =>
                `${SCHEMES[entry.scheme] ?? entry.scheme} ${entry.value}`,
            ),
          ),
        },
        { label: "Instrument", value: candidate?.name ?? candidate?.id ?? "—" },
        {
          label: "Instrument venue · currency",
          value: joined(ids.mic, ids.currency),
        },
        {
          label: "Instrument identifiers",
          value: joined(
            ...["isin", "figi", "lei", "cik", "caip19"].map((key) =>
              ids[key] ? `${SCHEMES[key]} ${ids[key]}` : null,
            ),
          ),
        },
        {
          label: "Evidence",
          value: joined(
            ...item.evidence.map(
              (entry) =>
                `${SCHEMES[entry.scheme] ?? entry.scheme} ${entry.value}${entry.source ? ` (${entry.source})` : ""}`,
            ),
          ),
        },
        ...(item.agent_answer
          ? [
              {
                label: "Agent's answer",
                value: item.agent_answer.relation.startsWith("same_")
                  ? "Same instrument"
                  : "Not this instrument",
              },
            ]
          : []),
        ...(item.settled_by
          ? [
              {
                label: "Settled by",
                value: SETTLED_BY[item.settled_by] ?? item.settled_by,
              },
            ]
          : []),
      ];
    },
    actions: ({ data: item, status }: IdentityRepair) => {
      if (status === "open")
        return [
          ...match(item, "Same instrument"),
          ...dismiss(item, "Not this instrument"),
        ];
      if (status !== "agent" || !item.agent_answer) return [];
      // Confirm repeats the agent's answer as the user's; Override gives the other one.
      const agentSaidSame = item.agent_answer.relation.startsWith("same_");
      return agentSaidSame
        ? [...match(item, "Confirm"), ...dismiss(item, "Override")]
        : [
            ...dismiss(item, "Confirm").map((action) => ({
              ...action,
              emphasis: "primary" as const,
            })),
            ...match(item, "Override").map((action) => ({
              ...action,
              emphasis: "secondary" as const,
            })),
          ];
    },
  };
}
