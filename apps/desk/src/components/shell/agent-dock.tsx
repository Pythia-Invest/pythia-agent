"use client";

import { cn, IconButton, Tabs, TabPanel } from "@pythia/ui";
import { MessageCircle, SquarePen, X } from "lucide-react";
import type { ReactNode } from "react";
import { ChatView } from "@/components/chat/chat-view";
import { NewChat } from "@/components/chat/new-chat";
import type { HermesSession } from "@/server/types";
import { ChatHistory } from "./chat-history";
import { type ChatTab, ChatTabs } from "./chat-tabs";
import type { DockTab } from "./use-dock-tabs";
import type { NewChatDraft } from "@/components/chat/new-chat";

export interface AgentDockProps {
  onCloseChat: (sessionId: string) => void;
  onHide: () => void;
  /** Opens another independently closable draft. */
  onNewChat: () => void;
  /** Swaps the docked conversation without leaving the current page. */
  onSelectChat: (sessionId: string) => void;
  onSelectTab: (tabId: string) => void;
  onDraftChange: (tabId: string, draft: NewChatDraft) => void;
  onStarted: (tabId: string, sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  /** Active UI tab, or null after all tabs have been closed. */
  activeId: string | null;
  /** Every chat, for the history behind the clock. */
  sessions: readonly HermesSession[];
  /** Open chats, in strip order. */
  tabs: readonly (ChatTab & DockTab)[];
  workingIds?: ReadonlySet<string> | undefined;
  unreadIds?: ReadonlySet<string> | undefined;
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
  activeId,
  onSelectTab,
  onDraftChange,
  onStarted,
  sessions,
  tabs,
  workingIds,
  unreadIds,
}: AgentDockProps) {
  return (
    <aside
      aria-label="Pythia"
      className="relative flex h-full min-w-0 flex-col bg-raised"
    >
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        value={activeId}
        onValueChange={(value) => {
          if (typeof value === "string") onSelectTab(value);
        }}
      >
        <header className="flex h-10 flex-none items-stretch border-border/50 border-b bg-canvas max-[899px]:h-12">
          <ChatTabs
            activeId={activeId}
            onClose={onCloseChat}
            onSelect={onSelectTab}
            tabs={tabs}
            runningIds={workingIds}
            unreadIds={unreadIds}
          />
          <div className="flex flex-none items-center gap-0.5 px-1">
            {/* A phone header takes full-size touch targets. */}
            <IconButton
              className="max-[899px]:size-11"
              label="New chat"
              onClick={onNewChat}
              size="sm"
            >
              <SquarePen className="stroke-[1.6]" />
            </IconButton>
            <ChatHistory
              onSelect={onSelectChat}
              onTogglePin={onTogglePin}
              openIds={
                new Set(
                  tabs.flatMap((tab) => (tab.sessionId ? [tab.sessionId] : [])),
                )
              }
              pinnedIds={pinnedIds}
              sessions={sessions}
              workingIds={workingIds}
              unreadIds={unreadIds}
            />
            <IconButton
              className="max-[899px]:size-11"
              label="Hide Pythia"
              onClick={onHide}
              size="sm"
            >
              <X className="stroke-[1.6]" />
            </IconButton>
          </div>
        </header>
        {/* Starting a chat here keeps you on the page you are working on: the
          first prompt creates the session and the dock opens it in place. */}
        {tabs.map((tab) => (
          <TabPanel
            key={tab.id}
            value={tab.id}
            keepMounted
            className="flex inert:hidden min-h-0 flex-1 flex-col py-0 data-[hidden]:hidden"
          >
            {tab.sessionId ? (
              <ChatView sessionId={tab.sessionId} />
            ) : (
              <NewChat
                draftKey={tab.id}
                draft={tab.draft}
                onDraftChange={(draft) => onDraftChange(tab.id, draft)}
                onStarted={(sessionId) => onStarted(tab.id, sessionId)}
              />
            )}
          </TabPanel>
        ))}
        {tabs.length === 0 ? (
          <p className="m-auto text-body text-foreground-secondary">
            Open a chat to get started.
          </p>
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
        "motion-fast flex w-11 flex-none cursor-pointer flex-col items-center border-0 border-border/50 border-l bg-canvas pt-3 text-foreground-secondary transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
        className,
      )}
      onClick={onOpen}
      type="button"
    >
      <MessageCircle aria-hidden="true" className="size-3.5 stroke-[1.6]" />
    </button>
  );
}

/**
 * The closed dock on a phone: the edge strip would take width from the page,
 * so it becomes a floating button in the corner that opens the same dock as a
 * sheet.
 */
export function AgentDockButton({
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
        "motion-fast fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 grid size-12 cursor-pointer place-items-center rounded-pill border-0 bg-primary text-primary-foreground shadow-popup transition-transform focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:scale-95",
        className,
      )}
      onClick={onOpen}
      type="button"
    >
      <MessageCircle aria-hidden="true" className="size-5 stroke-[1.75]" />
    </button>
  );
}
