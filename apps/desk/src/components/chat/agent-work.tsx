"use client";

import { Button, cn } from "@pythia/ui";
import { ArrowLeft } from "lucide-react";
import { type RefObject, useMemo } from "react";
import { useAgentWork } from "@/client/queries";
import type { WorkAgent, WorkAssignment } from "@/work/types";
import { agentFinished } from "./agent-presentation";
import { AssistantMessage } from "./assistant-message";
import { CHAT_MEASURE_CLASS } from "./chat-opening";
import { AgentMark } from "./activity-rows";
import { activityTurn } from "./turn-model";
import { Conversation, type ConversationPosition } from "./conversation";
import { UserMessage } from "./user-message";

/** How the header describes a child: its native status, and whether it answered. */
function agentState(agent: WorkAgent, finished: boolean, answered: boolean) {
  // An unconfirmed status stays explicit rather than implying the child works.
  if (!finished && agent.status === "unknown")
    return { mark: "unknown" as const, label: "status unknown" };
  if (!finished) return { mark: "running" as const, label: "working" };
  if (agent.status === "failed")
    return { mark: "failed" as const, label: "stopped with an error" };
  if (agent.status === "stopped" || !answered)
    return { mark: "stopped" as const, label: "stopped early" };
  return { mark: "completed" as const, label: "finished" };
}

export function AgentDetail({
  agent,
  sessionId,
  assignments,
  position,
  backRef,
  onBack,
}: {
  agent: WorkAgent;
  sessionId: string;
  assignments: WorkAssignment[];
  position: ConversationPosition;
  backRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
}) {
  const query = useAgentWork(
    sessionId,
    agent.sessionId ?? agent.id,
    !agentFinished(agent) && Boolean(agent.sessionId),
  );
  const newest = query.data?.pages[0];
  const assignment = newest?.assignment || agent.goal;
  const matches = assignments.filter((a) => a.goal === assignment);
  const context = matches.length === 1 ? matches[0]?.context : undefined;
  const finished = Boolean(newest?.ended) || agentFinished(agent);
  const messages = useMemo(() => {
    const saved = [...(query.data?.pages ?? [])]
      .reverse()
      .flatMap((p) => p.messages);
    // Keep other native user/system messages, but show the original assignment
    // once, even when the reader loads the page that contains its native row.
    return [...new Map(saved.map((m) => [m.id, m])).values()].filter(
      (m) => m.id !== newest?.assignmentId,
    );
  }, [query.data, newest?.assignmentId]);
  const hasReply = messages.some((m) => m.role === "assistant");
  const last = messages.findLast((m) => m.role === "assistant");
  // A child that ends mid-work leaves only tool steps: say so plainly.
  const answered = last ? Boolean(activityTurn(last, false).answer) : false;
  const state = agentState(agent, finished, answered || Boolean(agent.summary));
  return (
    <div
      data-slot="agent-detail"
      className="@container/chat flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header
        className={cn(
          CHAT_MEASURE_CLASS,
          "flex shrink-0 items-center justify-between gap-3 @[48rem]/chat:px-6 px-4 pt-2 pb-1",
        )}
        data-slot="agent-header"
      >
        <Button
          ref={backRef}
          variant="ghost"
          size="sm"
          className="-ms-2 text-foreground-secondary hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to chat
        </Button>
        <span
          className="flex min-w-0 items-center gap-1.5 text-body text-foreground-secondary"
          data-slot="agent-state"
        >
          <AgentMark status={state.mark} />
          <span className="truncate">Research agent · {state.label}</span>
        </span>
      </header>
      <Conversation
        messages={messages}
        position={position}
        beforeMessages={
          <UserMessage
            label="Task"
            message={{
              id: "assignment",
              role: "user",
              parts: [{ type: "text", text: assignment }],
            }}
          >
            {context ? (
              <details className="mt-1 border-border border-t pt-2">
                <summary className="cursor-pointer text-foreground-secondary text-xs">
                  Background it was given
                </summary>
                <p className="mb-0 whitespace-pre-wrap break-words font-reading text-reading leading-reading">
                  {context}
                </p>
              </details>
            ) : null}
          </UserMessage>
        }
        hasEarlier={query.hasNextPage}
        loadingEarlier={query.isFetchingNextPage}
        onLoadEarlier={() => query.fetchNextPage()}
        streaming={!finished && agent.status === "running" && hasReply}
        finalized={finished}
        turnStartedAt={0}
        approvalPending={false}
        onRespondToApproval={() => undefined}
        afterMessages={
          <>
            {query.isPending ? (
              <p role="status" className="sr-only">
                Loading the agent's conversation
              </p>
            ) : null}
            {query.isError ? (
              <div
                role="status"
                className="text-body text-foreground-secondary"
              >
                <p className="m-0">This conversation couldn't be refreshed.</p>
                <button
                  type="button"
                  className="cursor-pointer text-xs underline"
                  onClick={() => void query.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : null}
            {!query.isPending &&
            !query.isError &&
            !hasReply &&
            !agent.summary ? (
              finished ? (
                <p className="text-body text-foreground-secondary">
                  This agent didn't leave a reply.
                </p>
              ) : (
                <AssistantMessage
                  message={{ id: "starting", role: "assistant", parts: [] }}
                  streaming
                  turnStartedAt={0}
                  approvalPending={false}
                  onRespondToApproval={() => undefined}
                />
              )
            ) : null}
            {finished && hasReply && !answered ? (
              agent.summary ? (
                <AssistantMessage
                  message={{
                    id: "summary",
                    role: "assistant",
                    parts: [{ type: "text", text: agent.summary }],
                  }}
                  streaming={false}
                  finalized
                  turnStartedAt={0}
                  approvalPending={false}
                  onRespondToApproval={() => undefined}
                />
              ) : (
                <p
                  className="m-0 text-body text-foreground-secondary"
                  data-slot="agent-no-answer"
                >
                  This agent stopped before it wrote an answer. Its work so far
                  is under the activity above.
                </p>
              )
            ) : null}
            {!hasReply && agent.summary ? (
              <AssistantMessage
                message={{
                  id: "summary",
                  role: "assistant",
                  parts: [{ type: "text", text: agent.summary }],
                }}
                streaming={false}
                finalized={finished}
                turnStartedAt={0}
                approvalPending={false}
                onRespondToApproval={() => undefined}
              />
            ) : null}
          </>
        }
      />
    </div>
  );
}
