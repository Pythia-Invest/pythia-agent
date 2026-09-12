"use client";

import { IconButton } from "@pythia/ui";
import { History, SquarePen } from "lucide-react";

export interface ChatHeaderProps {
  /** The conversation on screen; null on the new-chat surface. */
  chatTitle: string | null;
  /** Whether the chat list is beside this column at the current width. */
  listOpen: boolean;
  onNewChat: () => void;
  onShowList: () => void;
}

/**
 * The line above a conversation: which chat you are in, and the two controls
 * the chat list would otherwise carry.
 *
 * Those controls appear only while the list is hidden — with the list beside
 * the column they would be a second copy of buttons already on screen. The
 * title is set quietly: the thread beneath it is what you came to read.
 */
export function ChatHeader({
  chatTitle,
  listOpen,
  onNewChat,
  onShowList,
}: ChatHeaderProps) {
  return (
    <header
      className="flex h-11 flex-none items-center gap-0.5 px-2"
      data-slot="chat-header"
    >
      {listOpen ? null : (
        <>
          {/* Alone in the column with no panel beside it, so this names what
              it brings back rather than a direction. */}
          <IconButton label="Show chats" onClick={onShowList} size="sm">
            <History className="stroke-[1.6]" />
          </IconButton>
          <IconButton label="New chat" onClick={onNewChat} size="sm">
            <SquarePen className="stroke-[1.6]" />
          </IconButton>
        </>
      )}
      {chatTitle ? (
        <span className="min-w-0 flex-1 truncate px-2 font-medium text-body text-foreground-secondary">
          {chatTitle}
        </span>
      ) : null}
    </header>
  );
}
