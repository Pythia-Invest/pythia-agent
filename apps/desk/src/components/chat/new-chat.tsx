"use client";

import type { WorkspaceContext } from "@/workspace/references";

import type { Attachment } from "@/attachments";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDeskApi } from "@/client/providers";
import { deskKeys } from "@/client/queries";
import { useModelOptions } from "@/client/queries";
import {
  type ModelSelection,
  normalizeModelSelection,
} from "@/server/model-catalog";
import { chatHref } from "@/components/shell/sidebar-model";
import { CHAT_MEASURE_CLASS, ChatOpeningLayout } from "./chat-opening";
import { CatalogError } from "./chat-status";
import { Composer } from "./composer";
import { storePendingPrompt, titleFromPrompt } from "./pending-prompt";
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
    try {
      const session = await api.createSession(
        titleFromPrompt(prompt || attachments[0]?.name || "New chat"),
      );
      storePendingPrompt(session.id, prompt, attachments, context);
      if (resolvedSelection)
        writeModelPreference(resolvedSelection, session.id);
      void queryClient.invalidateQueries({ queryKey: deskKeys.sessions });
      if (onStarted) onStarted(session.id);
      else {
        router.push(chatHref(session.id));
      }
    } catch (caught) {
      setCreating(false);
      throw caught;
    }
  };

  return (
    <div
      className="@container/chat flex min-h-0 flex-1 flex-col text-body"
      data-slot="new-chat"
    >
      <ChatOpeningLayout
        composer={
          <div className={CHAT_MEASURE_CLASS}>
            <Composer
              draftKey={draftKey}
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
          </div>
        }
      />
    </div>
  );
}
