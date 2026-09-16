"use client";

import { IconButton } from "@pythia/ui";
import { History, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ChatHeaderProps {
  /** The conversation on screen; null on the new-chat surface. */
  chatTitle: string | null;
  onNewChat: () => void;
  onShowList: () => void;
  onRename?: ((title: string) => Promise<void>) | undefined;
}

function EditableTitle({
  title,
  onRename,
}: {
  title: string;
  onRename: (title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  function close(restoreFocus: boolean) {
    setEditing(false);
    if (restoreFocus) requestAnimationFrame(() => button.current?.focus());
  }
  async function save(restoreFocus: boolean) {
    if (saving.current) return;
    const next = draft.trim();
    if (!next) {
      setError("Enter a chat title.");
      return;
    }
    if (next === title) return close(restoreFocus);
    saving.current = true;
    setPending(true);
    setError("");
    try {
      await onRename(next);
      close(restoreFocus);
    } catch {
      setError("Could not rename this chat. Try again.");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return editing ? (
    <form
      data-slot="chat-title-editor"
      className="min-w-0 max-w-full"
      onSubmit={(event) => {
        event.preventDefault();
        void save(true);
      }}
    >
      <div className="grid min-w-0 font-medium text-body">
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 h-8 min-w-12 whitespace-pre border border-transparent px-2"
        >
          {draft || " "}
        </span>
        <input
          ref={input}
          aria-label="Chat title"
          aria-invalid={Boolean(error)}
          className="col-start-1 row-start-1 h-8 w-full min-w-0 rounded-control border border-border-strong bg-raised px-2 font-medium text-body text-foreground outline-ring focus-visible:outline-2"
          size={1}
          maxLength={120}
          readOnly={pending}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onBlur={() => {
            void save(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) {
              event.preventDefault();
              close(true);
            }
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="px-2 text-error text-xs">
          {error}
        </p>
      ) : null}
    </form>
  ) : (
    <button
      ref={button}
      data-slot="chat-title"
      type="button"
      aria-label={`Rename chat: ${title}`}
      title="Rename chat"
      className="h-8 min-w-0 truncate rounded-control border border-transparent px-2 text-left font-medium text-body text-foreground-secondary outline-ring hover:border-border hover:bg-interaction-hover focus-visible:border-border focus-visible:outline-2"
      onClick={() => {
        setDraft(title);
        setError("");
        setEditing(true);
      }}
    >
      {title}
    </button>
  );
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
  onNewChat,
  onShowList,
  onRename,
}: ChatHeaderProps) {
  return (
    <header
      className="flex min-h-11 flex-none items-center gap-0.5 px-2 py-1"
      data-slot="chat-header"
    >
      <div className="flex items-center gap-0.5 [[data-desk-list-open=true]_&]:hidden">
        {/* Alone in the column with no panel beside it, so this names what
              it brings back rather than a direction. */}
        <IconButton label="Show chats" onClick={onShowList} size="sm">
          <History className="stroke-[1.6]" />
        </IconButton>
        <IconButton label="New chat" onClick={onNewChat} size="sm">
          <SquarePen className="stroke-[1.6]" />
        </IconButton>
      </div>
      {chatTitle && onRename ? (
        <EditableTitle title={chatTitle} onRename={onRename} />
      ) : chatTitle ? (
        <span className="min-w-0 flex-1 truncate px-2 font-medium text-body text-foreground-secondary">
          {chatTitle}
        </span>
      ) : null}
    </header>
  );
}
