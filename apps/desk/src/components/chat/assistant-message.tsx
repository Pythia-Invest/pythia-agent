"use client";

import { Fragment, useContext, useMemo } from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import type { OptimisticSteer } from "@/client/desk-chat";
import type { ApprovalChoice } from "@/server/types";
import { ApprovalCard, AssistantText, RunStatusNote } from "./message-parts";
import { hasVisibleWork, TurnActivity } from "./turn-activity";
import { TurnWork, turnAgents } from "./turn-work";
import {
  activityTurn,
  type SteerPart,
  segmentSeconds,
  steerSegments,
  toolPending,
} from "./turn-model";
import { AnswerActions } from "./answer-actions";
import { SteerMessage } from "./user-message";
import { CitationPagesProvider } from "./citations";

export type RespondToApproval = (
  runId: string,
  choice: ApprovalChoice,
  requestId?: string,
) => void;

type AssistantMessageProps = {
  approvalPending: boolean;
  message: DeskUIMessage;
  onRetry?: (() => void) | undefined;
  onRespondToApproval: RespondToApproval;
  streaming: boolean;
  turnStartedAt: number;
  finalized?: boolean;
  onInspectActivity?: (() => void) | undefined;
  /** The newest reply keeps its actions visible; earlier ones reveal on hover. */
  latest?: boolean;
};

/**
 * One Hermes run. Guidance the user sent while it worked is shown where the
 * run received it, as their own message: the work before it closes there, and
 * the work after it continues below.
 */
export function AssistantMessage({
  sending = [],
  ...props
}: AssistantMessageProps & {
  /** Guidance already shown to the reader that the run has not reported yet. */
  sending?: OptimisticSteer[];
}) {
  const { message, turnStartedAt } = props;
  const segments = useMemo(
    () =>
      steerSegments([
        ...message.parts,
        // The same id the reported part will carry, so the hand-off is stable.
        ...sending.map(
          (steer): SteerPart => ({
            type: "data-steer",
            id: steer.id,
            data: {
              text: steer.text,
              at: steer.at,
              ...(steer.context ? { context: steer.context } : {}),
            },
          }),
        ),
      ]),
    [message.parts, sending],
  );
  const seconds = segmentSeconds(
    segments,
    turnStartedAt,
    message.metadata?.run?.durationSeconds,
  );
  // Always a list, so earlier work keeps its state when guidance arrives.
  return (
    <CitationPagesProvider parts={message.parts}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.steer ? (
            <SteerMessage
              entering={sending.some((item) => item.id === segment.steer?.id)}
              id={segment.steer.id ?? `${message.id}:steer:${index}`}
              key={segment.steer.id ?? "steer"}
              steer={segment.steer.data}
            />
          ) : null}
          <AssistantTurn
            {...props}
            key="turn"
            message={{ ...message, parts: segment.parts }}
            turnStartedAt={segment.steer?.data.at ?? turnStartedAt}
            duration={seconds[index]}
            closed={index < segments.length - 1}
          />
        </Fragment>
      ))}
    </CitationPagesProvider>
  );
}

function AssistantTurn({
  approvalPending,
  message,
  onRetry,
  onRespondToApproval,
  streaming,
  turnStartedAt,
  finalized,
  onInspectActivity,
  latest = true,
  duration = message.metadata?.run?.durationSeconds,
  closed = false,
}: AssistantMessageProps & {
  duration?: number | undefined;
  /** Work that ended where the user added guidance; never live, never the answer. */
  closed?: boolean;
}) {
  const turn = useMemo(
    () => activityTurn(message, streaming || finalized === false),
    [message, streaming, finalized],
  );
  // A turn Hermes reported complete is no longer live, even for the one render
  // in which its saved copy arrives before the stream state settles.
  const active =
    !closed &&
    streaming &&
    !turn.status.length &&
    message.metadata?.outcome !== "completed";
  // Work that begins after the answer started brings the live line back;
  // unfinished calls from before it never do.
  const firstProse = message.parts.findIndex(
    (part) =>
      part.type === "text" &&
      part.text.trim() &&
      part.providerMetadata?.pythia?.preview !== true,
  );
  const resumed =
    firstProse >= 0 &&
    message.parts
      .slice(firstProse)
      .some((part) => part.type === "dynamic-tool" && toolPending(part));
  const work = useContext(TurnWork);
  const agents = useMemo(
    () =>
      turnAgents(
        turn.steps,
        message.parts.flatMap((part) =>
          part.type === "data-agent" ? [part.data] : [],
        ),
        work?.agents ?? [],
      ),
    [turn.steps, message.parts, work?.agents],
  );
  const showActivity =
    hasVisibleWork(turn.steps, agents) || (active && turn.prose.length === 0);
  // Guidance that arrived before any visible work closes nothing to show.
  if (
    closed &&
    !showActivity &&
    !turn.prose.length &&
    !turn.approvals.length &&
    !turn.status.length
  )
    return null;
  return (
    <div
      className="group/message grid min-w-0 gap-1.5 text-start"
      data-role="assistant"
      data-slot="message"
    >
      {showActivity ? (
        <TurnActivity
          since={turnStartedAt}
          active={active}
          answering={turn.prose.length > 0}
          onInspect={onInspectActivity}
          duration={duration}
          runActive={streaming}
          steps={turn.steps}
          agents={agents}
          paused={turn.approvals.length > 0}
          resumed={resumed}
        />
      ) : null}
      {turn.prose.map((block) => (
        <div key={block.key} data-slot="assistant-prose">
          <AssistantText
            streaming={active && block.part.state === "streaming"}
            text={block.part.text}
          />
        </div>
      ))}
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
      {!streaming && !closed && turn.answer ? (
        <AnswerActions
          completedAt={message.metadata?.run?.completedAt}
          latest={latest}
          text={turn.answer.text}
        />
      ) : null}
    </div>
  );
}
