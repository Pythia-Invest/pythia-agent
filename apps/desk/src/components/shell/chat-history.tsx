"use client";

import { IconButton, Popover } from "@pythia/ui";
import { History, Pin, PinOff, Search } from "lucide-react";
import { type RefObject, useMemo, useRef, useState } from "react";
import type { HermesSession } from "@/server/types";
import {
  activityTitle,
  chatTitle,
  groupChats,
  groupChatsByTime,
  matchesChatQuery,
  relativeActivity,
} from "./sidebar-model";

export interface ChatHistoryProps {
  /** Chats already in the tab strip, marked so reopening is not a surprise. */
  openIds: ReadonlySet<string>;
  onSelect: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  sessions: readonly HermesSession[];
}

function HistoryRow({
  now,
  onSelect,
  onTogglePin,
  open,
  pinned,
  session,
}: {
  now: number;
  onSelect: () => void;
  onTogglePin: () => void;
  open: boolean;
  pinned: boolean;
  session: HermesSession;
}) {
  const title = chatTitle(session);
  const age = relativeActivity(session, now);
  return (
    // Everything sits in the flow, so nothing has to be centred with a
    // transform and no control can move out from under the pointer.
    <div className="group flex min-h-7 min-w-0 items-center gap-1 rounded-md pr-1 pl-2 hover:bg-interaction-hover">
      {/*
       * No selected state, even for the chat on screen. Every row does the
       * same thing — bring that chat up in the dock, opening a tab for it if
       * it has none — so marking one as current would suggest the rest behave
       * differently. Which chats are already tabs is what "Open" says.
       */}
      <button
        className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-1 text-start text-body text-foreground"
        onClick={onSelect}
        title={title}
        type="button"
      >
        {title}
      </button>
      {open ? (
        // Says the chat is already a tab, so picking it moves rather than adds.
        <span className="flex-none text-foreground-disabled text-xs">Open</span>
      ) : age ? (
        <span
          className="flex-none text-foreground-disabled text-xs tabular-nums"
          title={activityTitle(session) ?? undefined}
        >
          {age}
        </span>
      ) : null}
      <IconButton
        className="motion-fast size-5 flex-none rounded-sm text-foreground-secondary opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        label={pinned ? `Unpin ${title}` : `Pin ${title}`}
        onClick={onTogglePin}
        size="sm"
      >
        {pinned ? (
          <PinOff aria-hidden="true" className="stroke-[1.6]" />
        ) : (
          <Pin aria-hidden="true" className="stroke-[1.6]" />
        )}
      </IconButton>
    </div>
  );
}

function HistoryList({
  openIds,
  onSelect,
  onTogglePin,
  pinnedIds,
  searchRef,
  sessions,
}: ChatHistoryProps & { searchRef: RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState("");
  // Taken once, when the dropdown opens: it lives for a few seconds at a time.
  const [now] = useState(() => Date.now());

  const matched = useMemo(
    () => sessions.filter((session) => matchesChatQuery(session, query)),
    [query, sessions],
  );
  /*
   * Pins first, then by how recently Hermes saw each chat — the sidebar's
   * grouping, so the two readings of the same list agree.
   */
  const { pinned, recents } = groupChats(matched, pinnedIds);
  const timeGroups = useMemo(
    () => groupChatsByTime(recents, now),
    [now, recents],
  );

  const row = (session: HermesSession) => (
    <HistoryRow
      key={session.id}
      now={now}
      onSelect={() => onSelect(session.id)}
      onTogglePin={() => onTogglePin(session.id)}
      open={openIds.has(session.id)}
      pinned={pinnedIds.has(session.id)}
      session={session}
    />
  );

  return (
    <>
      <label className="flex h-9 flex-none cursor-text items-center gap-2 border-border border-b px-3 text-foreground-secondary">
        <Search
          aria-hidden="true"
          className="size-3.5 flex-none stroke-[1.6]"
        />
        <input
          aria-label="Search chats"
          className="min-w-0 flex-1 border-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-secondary"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          ref={searchRef}
          type="search"
          value={query}
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {pinned.length ? (
          <>
            <p className="m-0 flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-foreground-disabled text-xs">
              <Pin aria-hidden="true" className="size-3.5 stroke-[1.6]" />
              Pinned
            </p>
            {pinned.map(row)}
          </>
        ) : null}
        {timeGroups.map((group) => (
          <div key={group.label}>
            <p className="m-0 px-2 pt-1 pb-0.5 text-foreground-disabled text-xs">
              {group.label}
            </p>
            {group.sessions.map(row)}
          </div>
        ))}
        {matched.length === 0 ? (
          <p className="m-0 px-2 py-3 text-body text-foreground-disabled">
            {sessions.length ? "No chats match." : "No chats yet."}
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * Every chat, behind the clock in the docked panel's tab strip.
 *
 * A dropdown rather than a second panel: the strip already holds what you are
 * working on, so reaching the rest is a quick pick and should not cover the
 * conversation to do it. It carries search, pins and picking — the filing,
 * renaming and dragging belong to the chat list beside the rail, where there
 * is room for them.
 */
export function ChatHistory({ onSelect, ...props }: ChatHistoryProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        render={
          <IconButton
            className="data-[popup-open]:bg-interaction-active data-[popup-open]:text-foreground"
            label="Chat history"
            size="sm"
          >
            <History aria-hidden="true" className="stroke-[1.6]" />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner align="end" side="bottom" sideOffset={4}>
          {/* Opening it is an intent to find a chat, so focus lands in the
              field rather than on the popup. */}
          <Popover.Popup
            className="flex max-h-[min(28rem,70vh)] w-76 flex-col overflow-hidden p-0"
            initialFocus={searchRef}
          >
            <HistoryList
              {...props}
              onSelect={(sessionId) => {
                // Picking a chat is the whole point of the dropdown, so it
                // closes; pinning is an aside and leaves it open.
                setOpen(false);
                onSelect(sessionId);
              }}
              searchRef={searchRef}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
