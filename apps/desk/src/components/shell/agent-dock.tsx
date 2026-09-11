"use client";

import { cn, IconButton, Tabs, TabPanel } from "@pythia/ui";
import { MessageCircle, SquarePen, X } from "lucide-react";
import type { ReactNode } from "react";
import { ChatView } from "@/components/chat/chat-view";
import { NewChat } from "@/components/chat/new-chat";
import type { HermesSession } from "@/server/types";
import { ChatHistory } from "./chat-history";
import { type ChatTab, ChatTabs } from "./chat-tabs";

export interface AgentDockProps {
  onCloseChat: (sessionId: string) => void;
  onHide: () => void;
  /** Clears the docked conversation back to a fresh composer, in place. */
  onNewChat: () => void;
  /** Swaps the docked conversation without leaving the current page. */
  onSelectChat: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  /** The conversation to show, or null for the unsaved "New chat" tab. */
  sessionId: string | null;
  /** Every chat, for the history behind the clock. */
  sessions: readonly HermesSession[];
  /** Open chats, in strip order. */
  tabs: readonly ChatTab[];
}

/**
 * Pythia docked beside a page.
 *
 * The chats you are working on are tabs across the top, as in an editor: they
 * stay open as you move around the desk, and the panel shows whichever one you
 * last picked. Everything else is a dropdown behind the clock, so reaching an
 * older chat never covers the conversation you are reading.
 */
export function AgentDock({
  onCloseChat,
  onHide,
  onNewChat,
  onSelectChat,
  onTogglePin,
  pinnedIds,
  sessionId,
  sessions,
  tabs,
}: AgentDockProps) {
  return (
    <aside
      aria-label="Pythia"
      className="relative flex h-full min-w-0 flex-col bg-raised"
    >
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        value={sessionId ? `session:${sessionId}` : "draft"}
        onValueChange={(value) => {
          if (typeof value === "string" && value.startsWith("session:"))
            onSelectChat(value.slice(8));
          else if (value === "draft") onNewChat();
        }}
      >
        <header className="flex h-10 flex-none items-stretch border-border border-b bg-canvas">
          <ChatTabs
            activeId={sessionId}
            draft={sessionId === null}
            onClose={onCloseChat}
            onCloseDraft={() => {
              // The strip only offers this while a tab exists to fall back to.
              const last = tabs.at(-1);
              if (last) onSelectChat(last.id);
            }}
            onSelect={onSelectChat}
            tabs={tabs}
          />
          <div className="flex flex-none items-center gap-0.5 px-1">
            <IconButton label="New chat" onClick={onNewChat} size="sm">
              <SquarePen className="stroke-[1.6]" />
            </IconButton>
            <ChatHistory
              onSelect={onSelectChat}
              onTogglePin={onTogglePin}
              openIds={new Set(tabs.map((tab) => tab.id))}
              pinnedIds={pinnedIds}
              sessions={sessions}
            />
            <IconButton label="Hide Pythia" onClick={onHide} size="sm">
              <X className="stroke-[1.6]" />
            </IconButton>
          </div>
        </header>
        {/* Starting a chat here keeps you on the page you are working on: the
          first prompt creates the session and the dock opens it in place. */}
        {tabs.map((tab) => (
          <TabPanel
            key={tab.id}
            value={`session:${tab.id}`}
            className="flex min-h-0 flex-1 flex-col py-0"
          >
            <ChatView sessionId={tab.id} />
          </TabPanel>
        ))}
        {sessionId === null ? (
          <TabPanel value="draft" className="flex min-h-0 flex-1 flex-col py-0">
            <NewChat onStarted={onSelectChat} />
          </TabPanel>
        ) : null}
      </Tabs>
    </aside>
  );
}

/**
 * The closed dock: a full-height strip on the right edge that opens Pythia.
 *
 * The glyph sits at the top, where the button that closed the panel was, so
 * opening and closing does not move where you look for it.
 */
export function AgentDockRail({
  className,
  onOpen,
}: {
  className?: string;
  onOpen: () => void;
}): ReactNode {
  return (
    <button
      aria-label="Open Pythia"
      className={cn(
        "motion-fast flex w-11 flex-none cursor-pointer flex-col items-center border-0 border-border border-l bg-canvas pt-3 text-foreground-secondary transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
        className,
      )}
      onClick={onOpen}
      type="button"
    >
      <MessageCircle aria-hidden="true" className="size-3.5 stroke-[1.6]" />
    </button>
  );
}
