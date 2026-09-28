"use client";

import { cn } from "@pythia/ui";
import { ArrowDown } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import type { OptimisticSteer } from "@/client/desk-chat";
import { AssistantMessage, type RespondToApproval } from "./assistant-message";
import { CHAT_MEASURE_CLASS } from "./chat-opening";
import { SystemNote } from "./message-parts";
import { UserMessage } from "./user-message";

/**
 * The transcript column. The gap under the last message is wider than the one
 * between messages: the composer is a different kind of thing, and the action
 * bar should not read as belonging to it.
 */
export const TRANSCRIPT_CLASS =
  "grid gap-3 @[48rem]/chat:px-6 px-4 pt-2.5 pb-6";

/** Ephemeral view state, retained when switching between parent and child chats. */
export type ConversationPosition = { top: number; following: boolean };

export interface ConversationProps {
  approvalPending: boolean;
  messages: DeskUIMessage[];
  beforeMessages?: ReactNode;
  afterMessages?: ReactNode;
  /** Saved child history has no live stream; absence of one does not prove completion. */
  finalized?: boolean;
  position?: ConversationPosition;
  onAtLatestChange?: (atLatest: boolean) => void;
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => Promise<unknown>;
  onRetry?: (() => void) | undefined;
  onRespondToApproval: RespondToApproval;
  /** A reply is being produced for the last message. */
  streaming: boolean;
  /** Epoch ms the current turn was submitted; the origin for the first wait. */
  turnStartedAt: number;
  /** Guidance sent to the running reply that it has not yet reported. */
  steers?: OptimisticSteer[];
}

/** Before the assistant message exists: the same status line the turn will keep. */
export function PendingReply({ turnStartedAt }: { turnStartedAt: number }) {
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
  beforeMessages,
  afterMessages,
  finalized = true,
  position,
  onAtLatestChange,
  hasEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
  onRetry,
  onRespondToApproval,
  streaming,
  turnStartedAt,
  steers = [],
}: ConversationProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(position?.following ?? true);
  const lastScrollTopRef = useRef(0);
  const touchYRef = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(position?.following ?? true);
  useEffect(() => {
    onAtLatestChange?.(atBottom);
  }, [atBottom, onAtLatestChange]);
  const earlierAnchorRef = useRef<{
    height: number;
    top: number;
    firstId: string | undefined;
  } | null>(null);
  const lastMessage = messages.at(-1);
  // Only messages sent while this transcript is open settle in; history and
  // the saved copy that replaces a live turn appear without motion.
  const initialIds = useRef<Set<string> | null>(null);
  if (initialIds.current === null)
    initialIds.current = new Set(messages.map((message) => message.id));
  const justSent = (message: DeskUIMessage) =>
    streaming &&
    !initialIds.current?.has(message.id) &&
    messages.lastIndexOf(message) >= messages.length - 2;
  const delivered = new Set(
    lastMessage?.parts.flatMap((part) =>
      part.type === "data-steer" && part.id ? [part.id] : [],
    ),
  );
  const sending = steers.filter((steer) => !delivered.has(steer.id));
  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport?.clientHeight) return;
    const distance =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const movingDown = viewport.scrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = viewport.scrollTop;
    const nextAtBottom = distance <= 1;
    // A small upward gesture must stay detached. Only reaching the actual end
    // while moving down (or explicitly jumping there) resumes streaming follow.
    if (!nextAtBottom) followLatestRef.current = false;
    else if (movingDown) followLatestRef.current = true;
    setAtBottom(nextAtBottom && followLatestRef.current);
  };

  const stopFollowing = useCallback(() => {
    const viewport = viewportRef.current;
    // A gesture can pause streaming follow before the browser scrolls, but it
    // cannot move a transcript already at its top. Only actual scroll position
    // controls the jump button in handleScroll.
    if (!viewport || viewport.scrollTop <= 0) return;
    followLatestRef.current = false;
    lastScrollTopRef.current = viewport.scrollTop;
  }, []);

  const jumpToLatest = useCallback(() => {
    followLatestRef.current = true;
    setAtBottom(true);
    scrollToBottom("instant");
  }, [scrollToBottom]);
  // Whoever just wrote something wants to see it.
  const steerCount = steers.length;
  const seenSteers = useRef(steerCount);
  useLayoutEffect(() => {
    if (steerCount > seenSteers.current) jumpToLatest();
    seenSteers.current = steerCount;
  }, [steerCount, jumpToLatest]);

  // Restore a switched-away conversation without keeping its transcript mounted.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (position && !position.following && viewport) {
      viewport.scrollTop = position.top;
      lastScrollTopRef.current = viewport.scrollTop;
    } else scrollToBottom("instant");
    return () => {
      if (position && viewport) {
        // A drawer ancestor may already be detached when React cleans up its
        // descendants; detached elements report zero despite the last view.
        position.top = lastScrollTopRef.current;
        position.following = followLatestRef.current;
      }
    };
  }, [position, scrollToBottom]);
  useLayoutEffect(() => {
    if (followLatestRef.current) scrollToBottom("instant");
  }, [messages, streaming, scrollToBottom]);
  // Follow height changes through disclosure animations, not just token renders.
  // A reader's upward gesture immediately detaches this observer as well.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current) scrollToBottom("instant");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);
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
        className={cn(
          "h-full overflow-y-auto",
          atBottom ? "[overflow-anchor:none]" : "[overflow-anchor:auto]",
        )}
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
          if (event.deltaY < 0 && !event.ctrlKey) stopFollowing();
        }}
        ref={viewportRef}
      >
        <div
          ref={contentRef}
          className={cn(CHAT_MEASURE_CLASS, TRANSCRIPT_CLASS)}
        >
          {beforeMessages}
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
              <UserMessage
                entering={justSent(message)}
                key={message.id}
                message={message}
              />
            ) : message.role === "system" ? (
              <SystemNote key={message.id} message={message} />
            ) : (
              <AssistantMessage
                onInspectActivity={() => {
                  // Reading the activity must not be yanked away by new output.
                  followLatestRef.current = false;
                  const viewport = viewportRef.current;
                  if (viewport) lastScrollTopRef.current = viewport.scrollTop;
                }}
                approvalPending={approvalPending}
                finalized={finalized}
                latest={message === lastMessage}
                key={message.id}
                message={message}
                onRetry={
                  !streaming && message === lastMessage ? onRetry : undefined
                }
                onRespondToApproval={onRespondToApproval}
                streaming={streaming && message === lastMessage}
                {...(message === lastMessage ? { sending } : {})}
                turnStartedAt={turnStartedAt}
              />
            ),
          )}
          {streaming && lastMessage?.role === "user" ? (
            <PendingReply turnStartedAt={turnStartedAt} />
          ) : null}
          {afterMessages}
        </div>
      </div>
      {!atBottom ? (
        <button
          aria-label="Jump to latest"
          title="Jump to latest"
          className="motion-fast absolute bottom-3 left-1/2 grid size-8 -translate-x-1/2 cursor-pointer place-items-center rounded-pill border border-border bg-overlay text-foreground shadow-popup transition-colors hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring"
          data-slot="jump-to-latest"
          onClick={jumpToLatest}
          type="button"
        >
          <ArrowDown aria-hidden="true" className="size-4 stroke-[1.8]" />
        </button>
      ) : null}
    </div>
  );
}
