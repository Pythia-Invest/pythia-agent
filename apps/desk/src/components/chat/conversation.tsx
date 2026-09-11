"use client";

import { cn } from "@pythia/ui";
import { ArrowDown } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import { AssistantMessage, type RespondToApproval } from "./assistant-message";
import { MessageAttachment } from "./attachment-card";
import { CHAT_MEASURE_CLASS } from "./chat-opening";
import { SystemNote } from "./message-parts";

export interface ConversationProps {
  approvalPending: boolean;
  messages: DeskUIMessage[];
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => Promise<unknown>;
  onRetry?: (() => void) | undefined;
  onRespondToApproval: RespondToApproval;
  /** A reply is being produced for the last message. */
  streaming: boolean;
  /** Epoch ms the current turn was submitted; the origin for the first wait. */
  turnStartedAt: number;
}

function UserMessage({ message }: { message: DeskUIMessage }) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  return (
    <div
      className="ms-auto grid w-fit min-w-0 max-w-[85%] gap-1.5 rounded-container border border-border bg-subtle px-3 py-2"
      data-role="user"
      data-slot="message"
    >
      {message.parts.some((part) => part.type === "file") ? (
        <div className="flex flex-wrap gap-1">
          {message.parts.flatMap((part, index) =>
            part.type === "file"
              ? [<MessageAttachment key={`${part.url}:${index}`} part={part} />]
              : [],
          )}
        </div>
      ) : null}
      {text ? (
        <div className="min-w-0 whitespace-pre-wrap break-words font-reading text-foreground text-reading leading-reading">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/** Before the assistant message exists: the same status line the turn will keep. */
function PendingReply({ turnStartedAt }: { turnStartedAt: number }) {
  return (
    <AssistantMessage
      approvalPending={false}
      message={{ id: "pending", role: "assistant", parts: [] }}
      onRespondToApproval={() => undefined}
      streaming
      turnStartedAt={turnStartedAt}
    />
  );
}

/**
 * The scrolling transcript. It follows new content while the reader is at the
 * bottom and offers a jump-back control once they scroll away.
 */
export function Conversation({
  approvalPending,
  messages,
  hasEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
  onRetry,
  onRespondToApproval,
  streaming,
  turnStartedAt,
}: ConversationProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const touchYRef = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const earlierAnchorRef = useRef<{
    height: number;
    top: number;
    firstId: string | undefined;
  } | null>(null);
  const lastMessage = messages.at(-1);
  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nextAtBottom = distance < 48;
    followLatestRef.current = nextAtBottom;
    setAtBottom(nextAtBottom);
  };

  const stopFollowing = useCallback(() => {
    followLatestRef.current = false;
    setAtBottom(false);
  }, []);

  const jumpToLatest = useCallback(() => {
    followLatestRef.current = true;
    setAtBottom(true);
    scrollToBottom("instant");
  }, [scrollToBottom]);

  // Start at the latest message, then keep following while pinned to the end.
  useLayoutEffect(() => {
    scrollToBottom("instant");
  }, [scrollToBottom]);
  useLayoutEffect(() => {
    if (followLatestRef.current) scrollToBottom("instant");
  }, [messages, streaming, scrollToBottom]);
  useLayoutEffect(() => {
    const anchor = earlierAnchorRef.current;
    const viewport = viewportRef.current;
    if (
      !anchor ||
      !viewport ||
      loadingEarlier ||
      messages[0]?.id === anchor.firstId
    )
      return;
    viewport.scrollTop = anchor.top + viewport.scrollHeight - anchor.height;
    earlierAnchorRef.current = null;
  }, [loadingEarlier, messages]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        className="h-full overflow-y-auto [overflow-anchor:none]"
        data-slot="conversation"
        onScroll={handleScroll}
        onTouchMove={(event) => {
          const y = event.touches[0]?.clientY;
          if (
            y !== undefined &&
            touchYRef.current !== null &&
            y > touchYRef.current
          )
            stopFollowing();
          if (y !== undefined) touchYRef.current = y;
        }}
        onTouchStart={(event) => {
          touchYRef.current = event.touches[0]?.clientY ?? null;
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) stopFollowing();
        }}
        ref={viewportRef}
      >
        <div
          className={cn(
            CHAT_MEASURE_CLASS,
            // The gap under the last message is wider than the one between
            // messages: the composer is a different kind of thing, and the
            // action bar should not read as belonging to it.
            "grid gap-3 @[48rem]/chat:px-6 px-4 pt-2.5 pb-6",
          )}
        >
          {hasEarlier ? (
            <button
              className="motion-fast h-6 cursor-pointer justify-self-center rounded-md border-0 bg-transparent px-2 text-foreground-secondary text-xs transition-colors hover:bg-interaction-hover hover:text-foreground disabled:opacity-disabled"
              disabled={loadingEarlier}
              onClick={() => {
                const viewport = viewportRef.current;
                if (viewport)
                  earlierAnchorRef.current = {
                    firstId: messages[0]?.id,
                    height: viewport.scrollHeight,
                    top: viewport.scrollTop,
                  };
                followLatestRef.current = false;
                void onLoadEarlier?.();
              }}
              type="button"
            >
              {loadingEarlier ? "Loading…" : "Load earlier"}
            </button>
          ) : null}
          {messages.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} />
            ) : message.role === "system" ? (
              <SystemNote key={message.id} message={message} />
            ) : (
              <AssistantMessage
                approvalPending={approvalPending}
                key={message.id}
                message={message}
                onRetry={
                  !streaming && message === lastMessage ? onRetry : undefined
                }
                onRespondToApproval={onRespondToApproval}
                streaming={streaming && message === lastMessage}
                turnStartedAt={turnStartedAt}
              />
            ),
          )}
          {streaming && lastMessage?.role === "user" ? (
            <PendingReply turnStartedAt={turnStartedAt} />
          ) : null}
        </div>
      </div>
      {/* Named, not a bare arrow: it appears only once you have scrolled away,
          so it has to say where it takes you. */}
      {!atBottom ? (
        <button
          className="motion-fast absolute bottom-2 left-1/2 flex h-6.5 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-pill border border-border bg-overlay pr-2.5 pl-2 font-medium text-foreground text-xs shadow-popup transition-colors hover:bg-interaction-hover"
          onClick={jumpToLatest}
          type="button"
        >
          <ArrowDown aria-hidden="true" className="size-3 stroke-[1.8]" />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
