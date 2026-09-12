"use client";

import { useMemo } from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import type { ApprovalChoice } from "@/server/types";
import { ApprovalCard, AssistantText, RunStatusNote } from "./message-parts";
import { ProcessBlock } from "./process-block";
import { splitTurn } from "./turn-model";
import { AnswerActions } from "./answer-actions";

export type RespondToApproval = (
  runId: string,
  choice: ApprovalChoice,
  requestId?: string,
) => void;

export function AssistantMessage({
  approvalPending,
  message,
  onRetry,
  onRespondToApproval,
  streaming,
  turnStartedAt,
}: {
  approvalPending: boolean;
  message: DeskUIMessage;
  onRetry?: (() => void) | undefined;
  onRespondToApproval: RespondToApproval;
  streaming: boolean;
  turnStartedAt: number;
}) {
  const turn = useMemo(
    () => splitTurn(message.id, message.parts),
    [message.id, message.parts],
  );
  const active = streaming && !turn.approvals.length && !turn.status.length;
  const processSteps = turn.blocks.flatMap((block) =>
    block.kind === "process" ? block.steps : [],
  );
  const firstProcess = turn.blocks.findIndex(
    (block) => block.kind === "process",
  );
  const latestProcess = turn.blocks.findLastIndex(
    (block) => block.kind === "process",
  );
  const latestPreview = turn.blocks.findLastIndex(
    (block) =>
      block.kind === "text" &&
      block.part.providerMetadata?.pythia?.preview === true,
  );
  const activityText =
    latestPreview > latestProcess && turn.blocks[latestPreview]?.kind === "text"
      ? turn.blocks[latestPreview].part.text
      : undefined;
  const answerStreaming =
    active &&
    turn.blocks.some(
      (block, index) =>
        index > latestProcess &&
        block.kind === "text" &&
        block.part.providerMetadata?.pythia?.preview !== true &&
        block.part.state === "streaming",
    );
  const processActive = active && !answerStreaming;
  const answerText = turn.blocks
    .flatMap((block) =>
      block.kind === "text" &&
      block.part.providerMetadata?.pythia?.preview !== true
        ? [block.part.text]
        : [],
    )
    .join("\n\n");
  return (
    <div
      className="grid min-w-0 gap-1.5 text-start"
      data-role="assistant"
      data-slot="message"
    >
      {turn.blocks.map((block, index) => {
        if (block.kind === "process") {
          if (index !== firstProcess) return null;
          return (
            <ProcessBlock
              active={processActive}
              activityText={activityText}
              duration={message.metadata?.run?.durationSeconds}
              key={block.key}
              runActive={streaming}
              since={turnStartedAt}
              steps={processSteps}
            />
          );
        }
        if (block.kind === "steer") {
          return (
            <div
              className="flex justify-start py-0.5"
              data-slot="steer-note"
              key={block.key}
            >
              <p className="m-0 max-w-[85%] truncate text-foreground-disabled text-xs leading-ui">
                Direction added · {block.part.data.text}
              </p>
            </div>
          );
        }
        if (active && block.part.providerMetadata?.pythia?.preview === true)
          return null;
        return (
          <div className="min-w-0" key={block.key}>
            <AssistantText
              streaming={streaming && block.part.state === "streaming"}
              text={block.part.text}
            />
          </div>
        );
      })}
      {processActive && firstProcess === -1 ? (
        <ProcessBlock
          active
          activityText={activityText}
          runActive
          since={turnStartedAt}
          steps={[]}
        />
      ) : null}
      {turn.approvals.map((part, index) => (
        <ApprovalCard
          active={streaming && !turn.status.length}
          data={part.data}
          key={part.id ?? index}
          onRespond={(choice) =>
            onRespondToApproval(part.data.runId, choice, part.data.requestId)
          }
          pending={approvalPending}
        />
      ))}
      {turn.status.map((part, index) => (
        <RunStatusNote
          data={part.data}
          key={part.id ?? index}
          onRetry={onRetry}
        />
      ))}
      {!streaming && answerText ? <AnswerActions text={answerText} /> : null}
    </div>
  );
}
