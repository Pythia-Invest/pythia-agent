"use client";

import { Button } from "@pythia/ui";
import { useAnswerQuestion } from "@/client/identity-queue";
import type { IdentityRepair } from "@/client/repairs";

const AGENT_ANSWERS: Record<string, string> = {
  unrelated: "not this instrument",
  none: "none of the candidates",
};

/** Detail and fix flow of an identity question: what the source's record
 * says beside the candidate, then the user's answer. Core applies the
 * authority rule, so an answer identifier evidence contradicts is refused. */
export function IdentityFix({ repair }: { repair: IdentityRepair }) {
  const item = repair.data;
  const answer = useAnswerQuestion();
  const same = item.answers.find(
    (entry) => entry.chosen_id && entry.relation.startsWith("same_"),
  );
  const other = item.answers.find((entry) => entry.relation === "unrelated");
  const record = item.record;
  const candidate = item.candidates.find(
    (entry) => entry.id === (same?.chosen_id ?? other?.chosen_id),
  );
  const rows: [string, string][] = [
    [
      `${item.label} record`,
      [
        record?.name,
        record?.native_ref?.native_id,
        [record?.ticker, record?.mic].filter(Boolean).join(" · "),
        record?.currency,
      ]
        .filter(Boolean)
        .join(" · ") || "No details",
    ],
    ...(candidate
      ? [["Instrument", candidate.name ?? candidate.id] as [string, string]]
      : []),
    ...(item.agent_answer
      ? [
          [
            "Agent's answer",
            `${AGENT_ANSWERS[item.agent_answer.relation] ?? "same instrument"} (provisional)`,
          ] as [string, string],
        ]
      : []),
  ];
  const busy = answer.isPending;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-foreground-secondary">{label}</dt>
            <dd className="m-0 min-w-0 text-foreground [overflow-wrap:anywhere]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {same || other ? (
        <div className="flex flex-wrap gap-2">
          {same ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                answer.mutate({
                  itemId: item.id,
                  relation: same.relation,
                  chosenId: same.chosen_id,
                })
              }
            >
              Same instrument
            </Button>
          ) : null}
          {other ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                answer.mutate({
                  itemId: item.id,
                  relation: other.relation,
                  chosenId: other.chosen_id,
                })
              }
            >
              Not this instrument
            </Button>
          ) : null}
        </div>
      ) : null}
      {answer.data || answer.error ? (
        <p role="status" className="m-0 text-foreground-secondary text-xs">
          {answer.data?.message ?? answer.error?.message}
        </p>
      ) : null}
    </div>
  );
}
