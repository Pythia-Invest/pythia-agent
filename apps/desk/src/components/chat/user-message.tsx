"use client";

import { cn } from "@pythia/ui";
import type { ReactNode } from "react";
import {
  type DeskUIMessage,
  type SteerData,
  userWorkspaceContext,
} from "@/client/chat-message";
import { MessageAttachment } from "./attachment-card";
import { TimelineDivider } from "./message-parts";
import { WorkspaceReferenceCards } from "./workspace-reference-cards";

export function UserMessage({
  message,
  label,
  children,
  entering = false,
}: {
  message: DeskUIMessage;
  label?: string;
  children?: ReactNode;
  /** Just sent: settle in rather than appear. */
  entering?: boolean;
}) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  return (
    <div
      className={cn(
        "ms-auto grid w-fit min-w-0 max-w-[85%] gap-1.5 rounded-container bg-subtle px-3.5 py-2.5",
        entering && "motion-safe:animate-enter",
      )}
      data-role="user"
      data-slot="message"
    >
      {label ? (
        <span className="text-foreground-secondary text-xs">{label}</span>
      ) : null}
      {message.parts.some((part) => part.type === "file") ? (
        <div className="flex flex-wrap gap-1">
          {message.parts.flatMap((part, index) =>
            part.type === "file"
              ? [<MessageAttachment key={`${part.url}:${index}`} part={part} />]
              : [],
          )}
        </div>
      ) : null}
      <WorkspaceReferenceCards context={userWorkspaceContext(message)} />
      {text ? (
        <div className="min-w-0 whitespace-pre-wrap break-words text-foreground text-reading leading-reading">
          {text}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Guidance sent while Pythia worked reads as what it is, the user's message,
 * marked on the timeline as steering the run rather than following it.
 */
export function SteerMessage({
  id,
  steer,
  entering = false,
}: {
  id: string;
  steer: Pick<SteerData, "text" | "context">;
  entering?: boolean;
}) {
  return (
    <div
      className={cn("grid gap-3", entering && "motion-safe:animate-enter")}
      data-slot="steer"
    >
      <TimelineDivider>Steered</TimelineDivider>
      <UserMessage
        message={{
          id,
          role: "user",
          parts: [
            { type: "text", text: steer.text },
            ...(steer.context
              ? [
                  {
                    type: "data-workspace-context" as const,
                    data: steer.context,
                  },
                ]
              : []),
          ],
        }}
      />
    </div>
  );
}
