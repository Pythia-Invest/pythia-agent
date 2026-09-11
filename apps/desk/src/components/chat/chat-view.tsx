"use client";

import { useChat } from "@ai-sdk/react";
import { Alert, Skeleton } from "@pythia/ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import { useDeskApi, useDeskChats } from "@/client/providers";
import {
  useCapabilities,
  useMessages,
  useModelOptions,
} from "@/client/queries";
import type { ApprovalChoice } from "@/server/types";
import {
  type ModelSelection,
  normalizeModelSelection,
} from "@/server/model-catalog";
import { CHAT_MEASURE_CLASS, ChatOpeningLayout } from "./chat-opening";
import { CatalogError, ConnectionNote } from "./chat-status";
import { Composer } from "./composer";
import { Conversation } from "./conversation";
import { ErrorMessage } from "./message-parts";
import { takePendingPrompt } from "./pending-prompt";
import {
  defaultSelection,
  ModelPicker,
  readModelPreference,
  writeModelPreference,
} from "./model-picker";

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
  hasEarlier,
  loadEarlier,
  loadingEarlier,
  sessionId,
}: {
  history: DeskUIMessage[];
  hasEarlier: boolean;
  loadEarlier: () => Promise<unknown>;
  loadingEarlier: boolean;
  sessionId: string;
}) {
  const api = useDeskApi();
  const chats = useDeskChats();
  const [session] = useState(() => chats.get(sessionId, history));
  const {
    connection,
    startedAt: turnStartedAt,
    stopError,
  } = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const models = useModelOptions();
  const capabilities = useCapabilities();
  const [selection, setSelection] = useState<ModelSelection | undefined>(() =>
    readModelPreference(sessionId),
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const resolvedSelection =
    selection && models.data
      ? normalizeModelSelection(models.data, selection)
      : selection;
  session.selection = resolvedSelection;
  useEffect(() => {
    if (!models.data) return;
    const next = resolvedSelection ?? defaultSelection(models.data);
    if (next && next !== selection) {
      setSelection(next);
      writeModelPreference(next, sessionId);
    }
  }, [models.data, resolvedSelection, selection, sessionId]);
  useEffect(() => {
    if (selection) writeModelPreference(selection, sessionId);
  }, [selection, sessionId]);
  const chat = useChat<DeskUIMessage>({ chat: session.chat, throttle: 40 });
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const send = session.send;
  const retry = session.retry;
  useEffect(() => {
    session.addHistory(history);
  }, [history, session]);
  useEffect(() => {
    session.initialize(() => takePendingPrompt(sessionId));
  }, [session, sessionId]);

  const respondToApproval = useCallback(
    async (runId: string, choice: ApprovalChoice, requestId?: string) => {
      setApprovalPending(true);
      setApprovalError(null);
      try {
        await api.respondToApproval(runId, choice, requestId);
        // A recovered run may be observed only through status polling. Record
        // the successful native response even when no SSE acknowledgement arrives.
        chat.setMessages((messages) =>
          messages.map((message) => ({
            ...message,
            parts: message.parts.map((part) =>
              part.type === "data-approval" &&
              part.data.runId === runId &&
              part.data.requestId === requestId
                ? { ...part, data: { ...part.data, responded: choice } }
                : part,
            ),
          })),
        );
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
    [api, chat.setMessages],
  );

  const busy = chat.status === "streaming" || chat.status === "submitted";
  const steer = useCallback(
    (text: string) =>
      session.transport.steer(sessionId, text).then(() => undefined),
    [sessionId, session],
  );

  /*
   * A chat Hermes has but nothing has been said in yet looks like a new one:
   * the question and the composer together, with the room left underneath.
   */
  const opening = chat.messages.length === 0 && !busy;
  const composer = (
    <div className={CHAT_MEASURE_CLASS}>
      {chat.error ? (
        <ErrorMessage
          className="mb-3"
          message={chat.error.message}
          model={resolvedSelection?.model}
          onRetry={retry}
          provider={resolvedSelection?.provider}
        />
      ) : null}
      {stopError ? (
        <Alert className="mb-3" title="Reply not stopped." tone="error">
          {stopError}
        </Alert>
      ) : null}
      {approvalError ? (
        <Alert className="mb-3" title="Approval not recorded." tone="error">
          {approvalError}
        </Alert>
      ) : null}
      <Composer
        notes={<ConnectionNote state={connection} />}
        controls={
          models.data && resolvedSelection ? (
            <ModelPicker
              catalog={models.data}
              disabled={busy}
              managerOpen={modelManagerOpen}
              onChange={(next) => {
                setSelection(next);
                writeModelPreference(next, sessionId);
              }}
              onManagerOpenChange={setModelManagerOpen}
              onPickerOpenChange={setModelPickerOpen}
              onRefresh={models.refreshModels}
              pickerOpen={modelPickerOpen}
              refreshing={models.isFetching || models.isRefreshing}
              selection={resolvedSelection}
            />
          ) : models.isError ? (
            <CatalogError
              onRetry={() => models.refreshModels()}
              retrying={models.isFetching || models.isRefreshing}
            />
          ) : undefined
        }
        onSend={send}
        onSteer={capabilities.data?.runSteer ? steer : undefined}
        onStop={() => void session.stop()}
        streaming={busy}
      />
    </div>
  );

  if (opening)
    return (
      <div
        className="@container/chat flex min-h-0 flex-1 flex-col text-body"
        data-slot="chat-view"
      >
        <ChatOpeningLayout composer={composer} />
      </div>
    );

  return (
    <div
      className="@container/chat flex min-h-0 flex-1 flex-col text-body"
      data-slot="chat-view"
    >
      <Conversation
        approvalPending={approvalPending}
        messages={chat.messages}
        hasEarlier={hasEarlier}
        loadingEarlier={loadingEarlier}
        onLoadEarlier={loadEarlier}
        onRetry={retry}
        onRespondToApproval={(runId, choice, requestId) =>
          void respondToApproval(runId, choice, requestId)
        }
        streaming={busy}
        turnStartedAt={turnStartedAt}
      />
      <div className="flex-none @[48rem]/chat:px-6 px-4 pb-2.5">{composer}</div>
    </div>
  );
}

/** An existing Hermes chat: history first, then the live conversation. */
export function ChatView({ sessionId }: { sessionId: string }) {
  const history = useMessages(sessionId);

  if (history.isPending) return <HistorySkeleton />;
  if (history.isError && !history.data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-6">
        <Alert title="This chat could not be loaded." tone="error">
          {history.error.message}
        </Alert>
      </div>
    );
  }
  return (
    <ChatSession
      hasEarlier={history.hasNextPage}
      history={history.data.pages}
      key={sessionId}
      loadEarlier={history.fetchNextPage}
      loadingEarlier={history.isFetchingNextPage}
      sessionId={sessionId}
    />
  );
}
