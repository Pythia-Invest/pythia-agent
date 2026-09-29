"use client";
import {
  type IdentityQuestion,
  useAnswerQuestion,
} from "@/client/identity-queue";
import { type IdentityRepair, isBuildQuestion } from "@/client/repairs";
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
const TAKEN = new Set(["confirmed", "no_match", "reopened"]);

type Answer = IdentityQuestion["answers"][number];

function joined(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ") || "—";
}

/** "Not a match": `unrelated` to a candidate, or `none` of them. */
function isNoMatch(answer: Answer) {
  return !answer.chosen_id || answer.relation === "unrelated";
}

/** A subject's identifiers in one line, such as "LEI … · CIK …". */
function identifierText(ids: Record<string, string | null>) {
  return joined(
    ...["isin", "figi", "lei", "cik", "caip19"].map((key) =>
      ids[key] ? `${SCHEMES[key]} ${ids[key]}` : null,
    ),
  );
}

function nameOf(item: IdentityQuestion, id: string | null) {
  const found = item.candidates.find((candidate) => candidate.id === id);
  return found?.name ?? id ?? "—";
}

/** An answer in words, naming the instrument it chose; a depositary receipt
 * is never "the same instrument" as its share. A build question's issuer
 * answer names the company. */
export function answerText(item: IdentityQuestion, answer: Answer) {
  if (isNoMatch(answer))
    return isBuildQuestion(item) ? "None of these" : "Not this instrument";
  const name = nameOf(item, answer.chosen_id);
  if (answer.relation === "depositary_receipt_of")
    return `A depositary receipt of ${name}`;
  if (answer.relation === "same_issuer")
    return item.subjects[0]?.level === "issuer"
      ? `Same company as ${name}`
      : `Issued by ${name}`;
  return `Same instrument as ${name}`;
}

/** The rows describing a question: the provider's record beside our
 * instruments and the evidence; a build question, which has no record, shows
 * the subject it asks about and its candidates. */
export function identityContext(item: IdentityQuestion) {
  const record = item.record;
  const built = isBuildQuestion(item);
  const several = item.candidates.length > 1;
  const noun = built ? "Candidate" : "Instrument";
  const candidates = item.candidates.flatMap((candidate, index) => {
    const ids = candidate.identifiers;
    const label = several ? `${noun} ${index + 1}` : noun;
    return [
      { label, value: candidate.name ?? candidate.id },
      // A company has no venue of its own.
      ...(candidate.level === "issuer"
        ? []
        : [
            {
              label: `${label} venue · currency`,
              value: joined(ids.mic, ids.currency),
            },
          ]),
      { label: `${label} identifiers`, value: identifierText(ids) },
    ];
  });
  // A subject the question is about besides its candidates, such as the
  // instrument a record is already bound to, or a build question's subject.
  const others = item.subjects.filter(
    (subject) =>
      subject.known &&
      !item.candidates.some((candidate) => candidate.id === subject.id),
  );
  const recordRows = record
    ? [
        {
          label: `${item.label} record`,
          value: joined(record.name, record.native_ref?.native_id),
        },
        {
          label: "Record venue · currency",
          value: joined(record.mic, record.currency),
        },
        {
          label: "Record identifiers",
          value: joined(
            ...record.identifiers.map(
              (entry) =>
                `${SCHEMES[entry.scheme] ?? entry.scheme} ${entry.value}`,
            ),
          ),
        },
      ]
    : [];
  // A build question's subject with its identifiers, such as a registrant's CIK.
  const otherRows = others.flatMap((subject) => [
    {
      label: built ? "Asked about" : "Other instrument",
      value: subject.name ?? subject.id,
    },
    ...(built
      ? [
          {
            label: "Asked about identifiers",
            value: identifierText(subject.identifiers),
          },
        ]
      : []),
  ]);
  return [
    { label: "Issue", value: item.question },
    ...(built ? otherRows : recordRows),
    ...(candidates.length
      ? candidates
      : [{ label: noun, value: "None offered" }]),
    ...(built ? [] : otherRows),
    ...(!built || item.evidence.length
      ? [
          {
            label: "Evidence",
            value: joined(
              ...item.evidence.map(
                (entry) =>
                  `${SCHEMES[entry.scheme] ?? entry.scheme} ${entry.value}${entry.source ? ` (${entry.source})` : ""}`,
              ),
            ),
          },
        ]
      : []),
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
    ...(item.settled_answer
      ? [{ label: "Answer", value: answerText(item, item.settled_answer) }]
      : []),
  ];
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
  const matchDialog = (item: IdentityQuestion, entry: Answer) => {
    const receipt = entry.relation === "depositary_receipt_of";
    if (isBuildQuestion(item))
      return {
        title: receipt ? "Depositary receipt" : "Issuer",
        description: `${answerText(item, entry)}. Your answer applies on this device; identifier evidence against it refuses it.`,
        noteLabel: "Note",
        notePlaceholder: "Why this is the answer…",
        confirmLabel: "Confirm answer",
        tone: "primary" as const,
      };
    return {
      title: receipt ? "Depositary receipt" : "Same instrument",
      description: `${
        receipt
          ? `Record ${item.label}'s record as a depositary receipt of`
          : `Bind ${item.label}'s record to`
      } ${nameOf(item, entry.chosen_id)}. Identifier evidence against it refuses the answer.`,
      noteLabel: "Note",
      notePlaceholder: "Why this record is this instrument…",
      confirmLabel: receipt ? "Confirm receipt" : "Confirm match",
      tone: "primary" as const,
    };
  };
  const noMatchDialog = (item: IdentityQuestion) =>
    isBuildQuestion(item)
      ? {
          title: "None of these",
          description:
            "Record that none of the candidates is the answer: the question closes and the answer stays unknown.",
          noteLabel: "Reason",
          notePlaceholder: "Why none of these…",
          confirmLabel: "None of these",
          tone: "danger" as const,
        }
      : {
          title: "Not this instrument",
          description: `Record that ${item.label}'s record is none of the instruments offered; its section then shows no match.`,
          noteLabel: "Reason",
          notePlaceholder: "Why this record is another instrument…",
          confirmLabel: "Not a match",
          tone: "danger" as const,
        };
  return {
    label: "Identity question",
    context: ({ data: item }: IdentityRepair) => identityContext(item),
    actions: ({ data: item, status }: IdentityRepair) => {
      // The user's answer to a build question is a local override; reopening undoes it.
      if (status !== "open")
        return isBuildQuestion(item)
          ? [
              {
                label: "Reopen",
                hint: "Undo your answer and ask the question again",
                emphasis: "secondary",
                dialog: {
                  title: "Reopen question",
                  description:
                    "Your answer stops applying on this device and the question opens again; its history keeps the answer.",
                  noteLabel: "Reason",
                  notePlaceholder: "Why reopen it…",
                  confirmLabel: "Reopen",
                  tone: "danger",
                },
                run: verdict(item, { relation: "reopen", chosen_id: null }),
              },
            ]
          : [];
      const agent = item.agent_answer;
      // A build question offers its one relation per candidate.
      const built = isBuildQuestion(item);
      const matches = item.answers.filter(
        (entry) =>
          entry.chosen_id && (built || entry.relation.startsWith("same_")),
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
          hint: built
            ? answerText(item, entry)
            : `Same instrument as ${nameOf(item, entry.chosen_id)}: bind the record to it`,
          emphasis: agent ? "secondary" : "primary",
          dialog: matchDialog(item, entry),
          run: verdict(item, entry),
        });
      });
      if (!agent || !isNoMatch(agent))
        actions.push({
          label: built ? "None of these" : "Not a match",
          hint: built
            ? "None of the candidates is the answer"
            : "The record is none of these instruments",
          emphasis: "secondary",
          dialog: noMatchDialog(item),
          run: verdict(item, { relation: "none", chosen_id: null }),
        });
      return actions;
    },
  };
}
