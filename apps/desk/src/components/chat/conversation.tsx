"use client";

import { ActivityIndicator, IconButton } from "@pythia/ui";
import { ArrowDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import type { ApprovalChoice } from "@/server/types";
import {
  ApprovalCard,
  AssistantText,
  ReasoningBlock,
  RunStatusNote,
  ToolRow,
} from "./message-parts";

export interface ConversationProps {
  approvalPending: boolean;
  messages: DeskUIMessage[];
  onRespondToApproval: (
    runId: string,
    choice: ApprovalChoice,
    requestId?: string,
  ) => void;
  /** True between sending and the first streamed token. */
  thinking: boolean;
  streaming: boolean;
}

function UserMessage({ message }: { message: DeskUIMessage }) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  return (
    <div className="flex justify-end" data-role="user" data-slot="message">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-[1.25rem] bg-subtle px-4 py-2.5 text-body text-foreground leading-reading">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  approvalPending,
  message,
  onRespondToApproval,
  streaming,
}: {
  approvalPending: boolean;
  message: DeskUIMessage;
  onRespondToApproval: ConversationProps["onRespondToApproval"];
  streaming: boolean;
}) {
  return (
    <div className="grid gap-2" data-role="assistant" data-slot="message">
      {message.parts.map((part, index) => {
        const key = `${message.id}:${index}`;
        switch (part.type) {
          case "text":
            return (
              <AssistantText
                key={key}
                streaming={streaming && part.state === "streaming"}
                text={part.text}
              />
            );
          case "reasoning":
            return part.text ? <ReasoningBlock key={key} part={part} /> : null;
          case "dynamic-tool":
            return <ToolRow key={key} part={part} />;
          case "data-approval":
            return (
              <ApprovalCard
                data={part.data}
                key={part.id ?? key}
                onRespond={(choice) =>
                  onRespondToApproval(
                    part.data.runId,
                    choice,
                    part.data.requestId,
                  )
                }
                pending={approvalPending}
              />
            );
          case "data-run-status":
            return <RunStatusNote data={part.data} key={key} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/**
 * The scrolling transcript. It follows new content while the reader is at the
 * bottom and offers a jump-back control once they scroll away.
 */
export function Conversation({
  approvalPending,
  messages,
  onRespondToApproval,
  streaming,
  thinking,
}: ConversationProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
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
    setAtBottom(distance < 48);
  };

  // Start at the latest message, then keep following while pinned to the end.
  useLayoutEffect(() => {
    scrollToBottom("instant");
  }, [scrollToBottom]);
  useEffect(() => {
    if (atBottom) scrollToBottom("instant");
  }, [atBottom, messages, thinking, scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        className="h-full overflow-y-auto"
        data-slot="conversation"
        onScroll={handleScroll}
        ref={viewportRef}
      >
        <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 pt-6 pb-8">
          {messages.length === 0 && !thinking ? (
            <p
              className="m-0 py-16 text-center text-foreground-disabled text-sm"
              data-slot="conversation-empty"
            >
              No messages yet. Ask something to start this chat.
            </p>
          ) : null}
          {messages.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} />
            ) : (
              <AssistantMessage
                approvalPending={approvalPending}
                key={message.id}
                message={message}
                onRespondToApproval={onRespondToApproval}
                streaming={streaming && message === lastMessage}
              />
            ),
          )}
          {thinking ? (
            <ActivityIndicator label="Thinking" size="small" />
          ) : null}
        </div>
      </div>
      {!atBottom ? (
        <IconButton
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-raised shadow-popup"
          label="Scroll to latest"
          onClick={() => scrollToBottom("smooth")}
          size="sm"
        >
          <ArrowDown />
        </IconButton>
      ) : null}
    </div>
  );
}
