"use client";

import { StrategyChatContext } from "@/components/workspace/strategies/strategy-context";
import { useState } from "react";
import { Button } from "@pythia/ui";
import { useRouter } from "next/navigation";
import { useDeskDrafts } from "@/client/providers";
import { useSessionContext } from "@/client/queries";
export function ChatContextNotice({ sessionId }: { sessionId: string }) {
  const context = useSessionContext(sessionId);
  const drafts = useDeskDrafts();
  const router = useRouter();
  const native = context.data;
  const [error, setError] = useState<string | null>(null);
  const badge = (
    <StrategyChatContext
      {...(native ? { context: native } : {})}
      pending={context.isPending}
    />
  );
  if (
    context.isPending ||
    native?.firstInputEligible ||
    native?.guidance === "current"
  )
    return badge;
  const legacy = native?.guidance === "legacy";
  return (
    <>
      <StrategyChatContext
        {...(native ? { context: native } : {})}
        pending={context.isPending}
      />
      <div
        data-slot="chat-context-notice"
        className="mb-2 flex flex-wrap items-center gap-2 text-foreground-secondary text-xs"
      >
        <p>
          {legacy
            ? "This conversation retains earlier Pythia instructions. You can resume it, or continue with current instructions in a new chat."
            : "This conversation’s saved instruction status is unavailable."}
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            try {
              const current = drafts.get(sessionId).context;
              drafts.stageNewChat({
                ...current,
                references: current.references,
                previousSessionId: sessionId,
                ...(native?.scope.status === "resolved"
                  ? { startStrategyPath: native.scope.reference.briefPath }
                  : {}),
              });
              router.push("/");
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Could not prepare a new chat.",
              );
            }
          }}
        >
          Continue in a new chat
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </>
  );
}
