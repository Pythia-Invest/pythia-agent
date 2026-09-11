"use client";

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
  /**
   * Hands back the session the first prompt created instead of routing to it.
   * The docked panel uses this to open the new chat where it already is.
   */
  onStarted?: ((sessionId: string) => void) | undefined;
}

/**
 * The empty surface behind "New chat". The first prompt creates the Hermes
 * session, which then takes over and sends it — on the chat route by default,
 * or in place wherever `onStarted` puts it.
 */
export function NewChat({ onStarted }: NewChatProps = {}) {
  const api = useDeskApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const models = useModelOptions();
  const [selection, setSelection] = useState<ModelSelection | undefined>(() =>
    readModelPreference(),
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const resolvedSelection =
    selection && models.data
      ? normalizeModelSelection(models.data, selection)
      : selection;
  useEffect(() => {
    if (!models.data) return;
    const next = resolvedSelection ?? defaultSelection(models.data);
    if (next && next !== selection) {
      setSelection(next);
      writeModelPreference(next);
    }
  }, [models.data, resolvedSelection, selection]);

  const start = async (prompt: string, attachments: Attachment[] = []) => {
    setCreating(true);
    try {
      const session = await api.createSession(
        titleFromPrompt(prompt || attachments[0]?.name || "New chat"),
      );
      storePendingPrompt(session.id, prompt, attachments);
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
