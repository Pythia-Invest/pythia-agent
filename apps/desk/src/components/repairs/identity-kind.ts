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
  user: "You",
};
/** A verdict that took effect; anything else keeps the dialog open with its reason. */
const TAKEN = new Set(["confirmed", "no_match"]);

type Answer = IdentityQuestion["answers"][number];

function joined(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ") || "—";
}

/** "Not a match": `unrelated` to a candidate, or `none` of them. */
function isNoMatch(answer: Answer) {
  return !answer.chosen_id || answer.relation === "unrelated";
}

function nameOf(item: IdentityQuestion, id: string | null) {
  const found = item.candidates.find((candidate) => candidate.id === id);
  return found?.name ?? id ?? "—";
}

/** An answer in words, naming the instrument it chose; a depositary receipt
 * is never "the same instrument" as its share. */
export function answerText(item: IdentityQuestion, answer: Answer) {
  if (isNoMatch(answer)) return "Not this instrument";
  const name = nameOf(item, answer.chosen_id);
  return answer.relation === "depositary_receipt_of"
    ? `A depositary receipt of ${name}`
    : `Same instrument as ${name}`;
}

/** Identity questions: the provider's record beside our instruments, the
 * evidence, and the user's answer recorded with an optional note. Each
 * candidate gets its own Match; "Not a match" answers none of them. */
export function useIdentityKind(): RepairKind<IdentityQuestion> {
  const answer = useAnswerQuestion();
  const verdict =
    (item: IdentityQuestion, entry: Answer) => async (note: string) => {
      const result = await answer.mutateAsync({
        itemId: item.id,
        relation: entry.relation,
        chosenId: entry.chosen_id,
        note,
      });
      if (!TAKEN.has(result.outcome)) throw new Error(result.message);
      return result.message;
    };
  const matchDialog = (item: IdentityQuestion, entry: Answer) => ({
    title:
      entry.relation === "depositary_receipt_of"
        ? "Depositary receipt"
        : "Same instrument",
    description: `${
      entry.relation === "depositary_receipt_of"
        ? `Record ${item.label}'s record as a depositary receipt of`
        : `Bind ${item.label}'s record to`
    } ${nameOf(item, entry.chosen_id)}. Identifier evidence against it refuses the answer.`,
    noteLabel: "Note",
    notePlaceholder: "Why this record is this instrument…",
    confirmLabel:
      entry.relation === "depositary_receipt_of"
        ? "Confirm receipt"
        : "Confirm match",
    tone: "primary" as const,
  });
  const noMatchDialog = (item: IdentityQuestion) => ({
    title: "Not this instrument",
    description: `Record that ${item.label}'s record is none of the instruments offered; its section then shows no match.`,
    noteLabel: "Reason",
    notePlaceholder: "Why this record is another instrument…",
    confirmLabel: "Not a match",
    tone: "danger" as const,
  });
  return {
    label: "Identity question",
    context: ({ data: item }: IdentityRepair) => {
      const record = item.record;
      const several = item.candidates.length > 1;
      const candidates = item.candidates.flatMap((candidate, index) => {
        const ids = candidate.identifiers;
        const label = several ? `Instrument ${index + 1}` : "Instrument";
        return [
          { label, value: candidate.name ?? candidate.id },
          {
            label: `${label} venue · currency`,
            value: joined(ids.mic, ids.currency),
          },
          {
            label: `${label} identifiers`,
            value: joined(
              ...["isin", "figi", "lei", "cik", "caip19"].map((key) =>
                ids[key] ? `${SCHEMES[key]} ${ids[key]}` : null,
              ),
            ),
          },
        ];
      });
      // A subject the question is about besides its candidates, such as the
      // instrument a record is already bound to.
      const others = item.subjects.filter(
        (subject) =>
          subject.known &&
          !item.candidates.some((candidate) => candidate.id === subject.id),
      );
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
        ...(candidates.length
          ? candidates
          : [{ label: "Instrument", value: "None offered" }]),
        ...others.map((subject) => ({
          label: "Other instrument",
          value: subject.name ?? subject.id,
        })),
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
                label: "Agent's suggestion",
                value: answerText(item, item.agent_answer),
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
      if (status !== "open") return [];
      const agent = item.agent_answer;
      const matches = item.answers.filter(
        (entry) => entry.chosen_id && entry.relation.startsWith("same_"),
      );
      const several = matches.length > 1;
      const actions: RepairAction[] = [];
      // Confirm sends the agent's answer as the user's own (ADR 0044 ruling 8),
      // through the same short dialog as every answer.
      if (agent)
        actions.push({
          label: "Confirm",
          hint: `Confirm the agent's answer: ${answerText(item, agent).toLowerCase()}`,
          emphasis: "primary",
          dialog: isNoMatch(agent)
            ? noMatchDialog(item)
            : matchDialog(item, agent),
          run: verdict(item, agent),
        });
      matches.forEach((entry, index) => {
        if (
          agent &&
          agent.relation === entry.relation &&
          agent.chosen_id === entry.chosen_id
        )
          return;
        actions.push({
          label: several ? `Match ${index + 1}` : "Match",
          hint: `Same instrument as ${nameOf(item, entry.chosen_id)}: bind the record to it`,
          emphasis: agent ? "secondary" : "primary",
          dialog: matchDialog(item, entry),
          run: verdict(item, entry),
        });
      });
      if (!agent || !isNoMatch(agent))
        actions.push({
          label: "Not a match",
          hint: "The record is none of these instruments",
          emphasis: "secondary",
          dialog: noMatchDialog(item),
          run: verdict(item, { relation: "none", chosen_id: null }),
        });
      return actions;
    },
  };
}
