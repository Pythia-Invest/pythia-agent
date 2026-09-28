"use client";

import type { SubjectPage } from "@pythia/market-data/subject";
import { Button } from "@pythia/ui";
import {
  type IdentityQuestion,
  useAnswerQuestion,
  useIdentityQuestions,
} from "@/client/identity-queue";

const AGENT_ANSWERS: Record<string, string> = {
  unrelated: "not this instrument",
  none: "none of the candidates",
};

/** Identity questions about this instrument, collapsed by default: open ones
 * and those only the agent answered (provisional). The user may answer one,
 * never has to. A section in conflict meanwhile shows its reason, or yields
 * to a ready source. */
export function IdentityIssues({ page }: { page: SubjectPage }) {
  const subjectId = page.subject.id;
  const questions = useIdentityQuestions(subjectId);
  const answer = useAnswerQuestion(subjectId);
  const items = questions.data ?? [];
  if (!items.length && !questions.isError) return null;
  return (
    <details
      data-slot="identity-issues"
      className="rounded-container border border-border/60 px-4 py-3 text-xs"
    >
      <summary className="cursor-pointer font-semibold text-body text-foreground">
        Identity questions ({items.length})
      </summary>
      <p className="mt-1 text-foreground-secondary">
        Source records that disagree with the reference data, or that could not
        be placed. You can answer one yourself, or ask the agent to review them.
      </p>
      {questions.isError ? (
        <p role="alert" className="mt-2 text-error">
          The questions could not be read. {questions.error.message}
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <Question
            key={item.id}
            item={item}
            busy={answer.isPending}
            onAnswer={(relation, chosenId) =>
              answer.mutate({ itemId: item.id, relation, chosenId })
            }
          />
        ))}
      </ul>
      {answer.data || answer.error ? (
        <p role="status" className="mt-2 text-foreground-secondary">
          {answer.data?.message ?? answer.error?.message}
        </p>
      ) : null}
    </details>
  );
}

function Question({
  item,
  busy,
  onAnswer,
}: {
  item: IdentityQuestion;
  busy: boolean;
  onAnswer(relation: string, chosenId: string | null): void;
}) {
  const same = item.answers.find(
    (entry) => entry.chosen_id && entry.relation.startsWith("same_"),
  );
  const other = item.answers.find((entry) => entry.relation === "unrelated");
  const record = item.record;
  const said = record
    ? [
        record.native_ref?.native_id,
        record.name,
        record.ticker,
        record.mic,
        record.currency,
      ].filter(Boolean)
    : [];
  const candidate = item.candidates.find(
    (entry) => entry.id === same?.chosen_id,
  );
  const agent = item.agent_answer;
  return (
    <li className="flex flex-col gap-1.5 border-border/60 border-t pt-2">
      <p className="text-foreground">{item.question}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-foreground-secondary">
        <dt>{item.label} record</dt>
        <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">
          {said.length ? said.join(" · ") : "No details"}
        </dd>
        {candidate ? (
          <>
            <dt>Candidate</dt>
            <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">
              {candidate.name ?? candidate.id}
            </dd>
          </>
        ) : null}
        {agent ? (
          <>
            <dt>Agent</dt>
            <dd className="min-w-0 text-foreground">
              {AGENT_ANSWERS[agent.relation] ?? "same instrument"} (provisional)
            </dd>
          </>
        ) : null}
      </dl>
      {same || other ? (
        <div className="flex flex-wrap gap-2">
          {same ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAnswer(same.relation, same.chosen_id)}
            >
              Same instrument
            </Button>
          ) : null}
          {other ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onAnswer(other.relation, other.chosen_id)}
            >
              Not this instrument
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
