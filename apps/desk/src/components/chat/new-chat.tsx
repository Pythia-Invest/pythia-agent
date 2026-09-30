"use client";

import type { WorkspaceContext } from "@/workspace/references";

import type { Attachment } from "@/attachments";
import { cn } from "@pythia/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDeskApi } from "@/client/providers";
import { deskKeys, MESSAGE_PAGE_SIZE } from "@/client/query-cache";
import { useModelOptions } from "@/client/queries";
import {
  type ModelSelection,
  normalizeModelSelection,
} from "@/server/model-catalog";
import { chatHref } from "@/components/shell/sidebar-model";
import { CHAT_MEASURE_CLASS, ChatOpeningLayout } from "./chat-opening";
import { CatalogError } from "./chat-status";
import { Composer } from "./composer";
import { PendingReply, TRANSCRIPT_CLASS } from "./conversation";
import { UserMessage } from "./user-message";
import { storePendingPrompt } from "./pending-prompt";
import {
  defaultSelection,
  ModelPicker,
  readModelPreference,
  writeModelPreference,
} from "./model-picker";

export interface NewChatProps {
  draftKey?: string | undefined;
  draft?: NewChatDraft | undefined;
  onDraftChange?: ((draft: NewChatDraft) => void) | undefined;
  /**
   * Hands back the session the first prompt created instead of routing to it.
   * The docked panel uses this to open the new chat where it already is.
   */
  onStarted?: ((sessionId: string) => void) | undefined;
}

/** Unsent editor state, owned by an individual dock tab, not a native session. */
export interface NewChatDraft {
  selection?: ModelSelection | undefined;
  /** Survives hiding the dock while native session creation is pending. */
  creating?: boolean;
}

/** First send creates a native session, then hands off in place or by route. */
export function NewChat({
  draftKey = "new",
  onStarted,
  draft,
  onDraftChange,
}: NewChatProps = {}) {
  const api = useDeskApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [localCreating, setLocalCreating] = useState(false);
  const creating = draft?.creating ?? localCreating;
  const setCreating = (next: boolean) => {
    setLocalCreating(next);
    if (draft) onDraftChange?.({ ...draft, creating: next });
  };
  const models = useModelOptions();
  const [localSelection, setLocalSelection] = useState<
    ModelSelection | undefined
  >(() => readModelPreference());
  const selection = draft?.selection ?? localSelection;
  const setSelection = (next: ModelSelection) => {
    setLocalSelection(next);
    if (draft) onDraftChange?.({ ...draft, selection: next });
  };
  // What was just sent, shown as the conversation it is about to become.
  const [sent, setSent] = useState<{ text: string; at: number } | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const resolvedSelection =
    selection && models.data
      ? normalizeModelSelection(models.data, selection)
      : selection;
  useEffect(() => {
    if (!models.data) return;
    const next = resolvedSelection ?? defaultSelection(models.data);
    if (next && (next !== selection || (draft && !draft.selection))) {
      setSelection(next);
      writeModelPreference(next);
    }
  }, [models.data, resolvedSelection, selection, draft?.selection]);

  const start = async (
    prompt: string,
    attachments: Attachment[] = [],
    context?: WorkspaceContext,
  ) => {
    if (creating)
      throw new Error("Your first message is already being submitted.");
    setCreating(true);
    setSent({ text: prompt, at: Date.now() });
    try {
      // Hermes derives and then improves the title. Supplying our own title
      // makes it user-owned and prevents native automatic replacement.
      const session = await api.createSession();
      storePendingPrompt(session.id, prompt, attachments, context);
      if (resolvedSelection)
        writeModelPreference(resolvedSelection, session.id);
      // A new chat has no history yet: open it at once instead of loading it.
      queryClient.setQueryData(deskKeys.messages(session.id), {
        pages: [{ data: [], limit: MESSAGE_PAGE_SIZE, offset: 0, returned: 0 }],
        pageParams: [0],
      });
      void queryClient.invalidateQueries({ queryKey: deskKeys.sessions });
      if (onStarted) onStarted(session.id);
      else {
        router.push(chatHref(session.id));
      }
    } catch (caught) {
      setCreating(false);
      setSent(null);
      throw caught;
    }
  };

  const composer = (key: string) => (
    <Composer
      draftKey={key}
      controls={
        models.data && resolvedSelection ? (
          <ModelPicker
            catalog={models.data}
            disabled={creating}
            managerOpen={modelManagerOpen}
            onChange={(next) => {
              setSelection(next);
              writeModelPreference(next);
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
      disabled={creating}
      onSend={start}
    />
  );

  // Don't wait for the new session to open: the message and the working line
  // appear the moment it is sent, where the chat route will show them.
  if (sent)
    return (
      <div
        className="@container/chat flex min-h-0 flex-1 flex-col text-body"
        data-slot="new-chat"
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(CHAT_MEASURE_CLASS, TRANSCRIPT_CLASS)}>
            <UserMessage
              entering
              message={{
                id: "sending",
                role: "user",
                parts: [{ type: "text", text: sent.text }],
              }}
            />
            <div className="motion-safe:animate-enter">
              <PendingReply turnStartedAt={sent.at} />
            </div>
          </div>
        </div>
        <div className="flex-none @[48rem]/chat:px-6 px-4 pb-2.5">
          {/* The prompt has left the field; its draft is cleared once sent. */}
          <div className={CHAT_MEASURE_CLASS}>
            {composer(`${draftKey}:sending`)}
          </div>
        </div>
      </div>
    );

  return (
    <div
      className="@container/chat flex min-h-0 flex-1 flex-col text-body"
      data-slot="new-chat"
    >
      <ChatOpeningLayout
        composer={
          <div className={CHAT_MEASURE_CLASS}>{composer(draftKey)}</div>
        }
      />
    </div>
  );
}
