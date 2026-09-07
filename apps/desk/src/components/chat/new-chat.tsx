"use client";

import { Alert } from "@pythia/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDeskApi } from "@/client/providers";
import { deskKeys } from "@/client/queries";
import { chatHref } from "@/components/shell/sidebar-model";
import { Composer } from "./composer";
import { storePendingPrompt, titleFromPrompt } from "./pending-prompt";

/**
 * The empty surface behind "New chat". The first prompt creates the Hermes
 * session, then the chat route takes over and sends it.
 */
export function NewChat() {
  const api = useDeskApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (prompt: string) => {
    setCreating(true);
    setError(null);
    try {
      const session = await api.createSession(titleFromPrompt(prompt));
      storePendingPrompt(session.id, prompt);
      void queryClient.invalidateQueries({ queryKey: deskKeys.sessions });
      router.push(chatHref(session.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not start a chat.",
      );
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-slot="new-chat">
      <div className="flex flex-1 items-center justify-center px-4">
        <h1 className="m-0 text-center font-medium text-display text-foreground leading-tight tracking-tight">
          What are we looking into?
        </h1>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {error ? (
          <Alert className="mb-3" title="Could not start a chat." tone="error">
            {error}
          </Alert>
        ) : null}
        <Composer disabled={creating} onSend={start} streaming={creating} />
        <p className="m-0 mt-2 text-center text-foreground-disabled text-xs">
          Pythia can be wrong. Verify anything you act on.
        </p>
      </div>
    </div>
  );
}
