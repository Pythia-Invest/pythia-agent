"use client";

import { Button, cn, IconButton, SidebarNav, SidebarSection } from "@pythia/ui";
import { ChevronsLeft, Pin, Search, SquarePen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HermesSession } from "@/server/types";
import { ChatGroup, GroupLabel } from "./chat-group";
import {
  type ChatTimeGroup,
  groupChats,
  groupChatsByTime,
  matchesChatQuery,
} from "./sidebar-model";

export type ChatListState = "loading" | "ready" | "unavailable";

export interface ChatPanelProps {
  activeId: string | null;
  className?: string;
  /** Shell-level query from the top bar, applied on top of the local filter. */
  globalQuery?: string;
  id?: string;
  onHide?: () => void;
  onNewChat: () => void;
  onRetry?: () => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
  /** Picks a chat in place rather than routing to it (the docked panel). */
  onSelectChat?: ((sessionId: string) => void) | undefined;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  sessions: readonly HermesSession[];
  state: ChatListState;
}

/**
 * The chat list beside the navigation rail: filter, start a chat, and pick one.
 *
 * Pins are a device-local convenience so they stay a group of their own at the
 * top; everything else is bucketed by how recently Hermes saw it. When only one
 * bucket has chats its heading is hidden — "Previous 7 days" standing alone
 * over the whole list says nothing a reader can use, and each row carries its
 * own age instead.
 */
export function ChatPanel({
  activeId,
  className,
  globalQuery = "",
  id,
  onHide,
  onNewChat,
  onRetry,
  onRename,
  onSelectChat,
  onTogglePin,
  pinnedIds,
  sessions,
  state,
}: ChatPanelProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  // Relative ages are client-only so server and first client render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const loading = state === "loading";
  const filtered = useMemo(
    () =>
      sessions.filter(
        (session) =>
          matchesChatQuery(session, query) &&
          matchesChatQuery(session, globalQuery),
      ),
    [globalQuery, query, sessions],
  );
  const { pinned, recents } = groupChats(filtered, pinnedIds);
  const timeGroups: readonly ChatTimeGroup[] = useMemo(
    () => groupChatsByTime(recents, now ?? undefined),
    [now, recents],
  );
  const searching = (query + globalQuery).trim().length > 0;
  const noMatches = searching && filtered.length === 0;

  const openSearch = () => {
    setSearchOpen(true);
    // Focus after the field exists, not before it is mounted.
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const closeSearch = () => {
    // Clearing on close keeps a hidden filter from silently shortening the list.
    setQuery("");
    setSearchOpen(false);
    searchTriggerRef.current?.focus();
  };

  return (
    <nav
      aria-busy={loading || undefined}
      aria-label="Chats"
      className={cn(
        "flex h-full w-62 min-w-0 flex-col border-border border-r bg-raised",
        className,
      )}
      id={id}
    >
      {/*
       * One stable row of controls, and search opens as a row beneath it.
       * Swapping the field in beside the buttons made every control jump
       * sideways; nothing moves horizontally now.
       */}
      <div className="flex flex-none flex-col gap-1 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1">
          <Button
            className="min-w-0 flex-1 justify-start gap-1.5"
            onClick={onNewChat}
            size="sm"
            variant="ghost"
          >
            <SquarePen aria-hidden="true" className="size-3.5 stroke-[1.6]" />
            New chat
          </Button>
          <IconButton
            aria-expanded={searchOpen}
            className={cn(
              searchOpen && "bg-interaction-active text-foreground",
            )}
            ref={searchTriggerRef}
            label="Search chats"
            onClick={searchOpen ? closeSearch : openSearch}
            size="sm"
          >
            <Search className="stroke-[1.6]" />
          </IconButton>
          {onHide ? (
            // Not the panel glyph: the rail's collapse button sits beside this
            // one, and two adjacent controls must not share an icon.
            <IconButton label="Hide chats" onClick={onHide} size="sm">
              <ChevronsLeft className="stroke-[1.6]" />
            </IconButton>
          ) : null}
        </div>
        {searchOpen ? (
          <label className="motion-fast flex h-8 min-w-0 cursor-text items-center gap-2 rounded-control border border-border bg-subtle px-2.5 text-foreground-secondary transition-colors focus-within:border-border-strong focus-within:bg-raised">
            <Search
              aria-hidden="true"
              className="size-3.5 flex-none stroke-[1.6]"
            />
            <input
              aria-label="Search chats"
              className="min-w-0 flex-1 border-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-secondary"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSearch();
                }
              }}
              placeholder="Search chats"
              ref={searchRef}
              type="search"
              value={query}
            />
          </label>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {loading ? <p className="sr-only">Loading chats…</p> : null}
        <SidebarNav aria-label="Chat list">
          {pinned.length || !searching ? (
            <ChatGroup
              activeId={activeId}
              emptyText={searching ? null : "No pinned chats."}
              heading="Pinned"
              icon={Pin}
              now={now}
              onSelect={onSelectChat}
              onTogglePin={onTogglePin}
              onRename={onRename}
              pinnedIds={pinnedIds}
              sessions={pinned}
              skeletonRows={loading ? 1 : 0}
            />
          ) : null}
          {loading ? (
            <ChatGroup
              activeId={activeId}
              heading="Recent"
              now={now}
              onTogglePin={onTogglePin}
              onRename={onRename}
              pinnedIds={pinnedIds}
              sessions={[]}
              skeletonRows={6}
            />
          ) : (
            timeGroups.length > 0 && (
              <SidebarSection
                aria-labelledby="desk-chats-recents"
                className="gap-0 py-0"
              >
                {/* Names the unpinned region so the break after Pinned reads. */}
                <GroupLabel id="desk-chats-recents" visible>
                  Recents
                </GroupLabel>
                {timeGroups.map((group) => (
                  <ChatGroup
                    activeId={activeId}
                    heading={group.label}
                    key={group.label}
                    now={now}
                    onSelect={onSelectChat}
                    onTogglePin={onTogglePin}
                    onRename={onRename}
                    pinnedIds={pinnedIds}
                    sessions={group.sessions}
                    // One bucket adds nothing over "Recents"; several date it.
                    showHeading={timeGroups.length > 1}
                    tone="bucket"
                  />
                ))}
              </SidebarSection>
            )
          )}
          {noMatches ? (
            <p className="m-0 px-2 py-1 text-body text-foreground-disabled leading-ui">
              No chats match.
            </p>
          ) : null}
          {!loading && !searching && sessions.length === 0 ? (
            <p className="m-0 px-2 py-1 text-body text-foreground-disabled leading-ui">
              No chats yet.
            </p>
          ) : null}
          {state === "unavailable" ? (
            <div className="grid gap-2 px-2 py-2" role="status">
              <p className="m-0 text-body text-foreground-secondary leading-ui">
                {sessions.length
                  ? "Showing the last chat list; Hermes is not responding."
                  : "Chats are unavailable while Hermes is offline."}
              </p>
              {onRetry ? (
                <Button
                  className="justify-self-start"
                  onClick={onRetry}
                  size="sm"
                  variant="secondary"
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
        </SidebarNav>
      </div>
    </nav>
  );
}
