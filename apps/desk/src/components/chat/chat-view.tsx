"use client";

import { useChat } from "@ai-sdk/react";
import { Alert, Skeleton } from "@pythia/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import { HermesChatTransport } from "@/client/hermes-transport";
import { useDeskApi } from "@/client/providers";
import { deskKeys, useMessages } from "@/client/queries";
import type { ApprovalChoice } from "@/server/types";
import { Composer } from "./composer";
import { Conversation } from "./conversation";
import { takePendingPrompt } from "./pending-prompt";

function HistorySkeleton() {
  return (
    <div
      className="mx-auto grid w-full max-w-3xl gap-6 px-4 pt-6"
      aria-busy="true"
    >
      <p className="sr-only">Loading conversation…</p>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/5" shape="block" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-full" shape="block" />
        <Skeleton className="h-4 w-11/12" shape="block" />
        <Skeleton className="h-4 w-3/5" shape="block" />
      </div>
    </div>
  );
}

function ChatSession({
  history,
  sessionId,
}: {
  history: DeskUIMessage[];
  sessionId: string;
}) {
  const api = useDeskApi();
  const queryClient = useQueryClient();
  const transport = useMemo(
    () =>
      new HermesChatTransport(api, {
        onRunFinished: (finished) => {
          void queryClient.invalidateQueries({ queryKey: deskKeys.sessions });
          void queryClient.invalidateQueries({
            queryKey: deskKeys.messages(finished),
          });
        },
      }),
    [api, queryClient],
  );
  const chat = useChat<DeskUIMessage>({
    id: sessionId,
    messages: history,
    transport,
    throttle: 40,
  });
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const sentPending = useRef(false);

  const send = useCallback(
    (text: string) => chat.sendMessage({ text }),
    [chat.sendMessage],
  );

  // A prompt typed on the new-chat surface is sent once the session route mounts.
  useEffect(() => {
    if (sentPending.current) return;
    sentPending.current = true;
    const pending = takePendingPrompt(sessionId);
    if (pending) void send(pending);
  }, [sessionId, send]);

  const respondToApproval = useCallback(
    async (runId: string, choice: ApprovalChoice, requestId?: string) => {
      setApprovalPending(true);
      setApprovalError(null);
      try {
        await api.respondToApproval(runId, choice, requestId);
      } catch (error) {
        setApprovalError(
          error instanceof Error
            ? error.message
            : "Could not answer the approval.",
        );
      } finally {
        setApprovalPending(false);
      }
    },
    [api],
  );

  const streaming = chat.status === "streaming";
  const busy = streaming || chat.status === "submitted";
  const lastMessage = chat.messages.at(-1);
  const thinking =
    busy &&
    (lastMessage?.role === "user" ||
      (lastMessage?.role === "assistant" && lastMessage.parts.length === 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-slot="chat-view">
      <Conversation
        approvalPending={approvalPending}
        messages={chat.messages}
        onRespondToApproval={(runId, choice, requestId) =>
          void respondToApproval(runId, choice, requestId)
        }
        streaming={streaming}
        thinking={thinking}
      />
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {chat.error ? (
          <Alert
            className="mb-3"
            title="This message could not be sent."
            tone="error"
          >
            {chat.error.message}
          </Alert>
        ) : null}
        {approvalError ? (
          <Alert className="mb-3" title="Approval not recorded." tone="error">
            {approvalError}
          </Alert>
        ) : null}
        <Composer
          onSend={send}
          onStop={() => void chat.stop()}
          streaming={busy}
        />
        <p className="m-0 mt-2 text-center text-foreground-disabled text-xs">
          Pythia can be wrong. Verify anything you act on.
        </p>
      </div>
    </div>
  );
}

/** An existing Hermes chat: history first, then the live conversation. */
export function ChatView({ sessionId }: { sessionId: string }) {
  const history = useMessages(sessionId);

  if (history.isPending) return <HistorySkeleton />;
  if (history.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-6">
        <Alert title="This chat could not be loaded." tone="error">
          {history.error.message}
        </Alert>
      </div>
    );
  }
  return (
    <ChatSession history={history.data} key={sessionId} sessionId={sessionId} />
  );
}
