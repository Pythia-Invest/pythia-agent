"use client";

import { cn, IconButton, Popover, Tab as UITab, TabsList } from "@pythia/ui";
import { MessageCircle, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { layOutTabs } from "./tabs-model";

export interface ChatTab {
  id: string;
  title: string;
}

export interface ChatTabsProps {
  activeId: string | null;
  /** True while no chat is open: the strip shows an unsaved "New chat" tab. */
  draft: boolean;
  onClose: (sessionId: string) => void;
  /**
   * Closes the unsaved chat and falls back to another tab. Only called when
   * one exists — a lone draft has nothing to close to.
   */
  onCloseDraft: () => void;
  onSelect: (sessionId: string) => void;
  /**
   * Chats with a run in flight, shown as a pulsing signal dot in place of the
   * chat glyph. The desk has no index of active runs yet, so the shell passes
   * nothing and every tab reads as idle; the slot is here because that is the
   * point of the strip — seeing that a chat you are not looking at is working.
   */
  runningIds?: ReadonlySet<string> | undefined;
  tabs: readonly ChatTab[];
}

/** The chat glyph, or a pulsing dot while that chat has a run in flight. */
function TabStatus({ running }: { running: boolean }) {
  if (running) {
    return (
      <span className="grid size-3.5 flex-none place-items-center">
        <span className="size-1.5 animate-pulse rounded-pill bg-signal" />
      </span>
    );
  }
  return (
    <MessageCircle
      aria-hidden="true"
      className="size-3.5 flex-none stroke-[1.6] text-foreground-secondary"
    />
  );
}

function Tab({
  active,
  className,
  onClose,
  running,
  tab,
}: {
  active: boolean;
  className: string;
  onClose: () => void;
  running: boolean;
  tab: ChatTab;
}) {
  return (
    // A positioning context, as in the chat rows: the select button fills the
    // tab so its hover reaches both edges and Close sits on top of it.
    <div
      data-slot="chat-tab"
      className={cn(
        className,
        active ? "bg-raised" : "bg-transparent hover:bg-interaction-hover",
      )}
    >
      <UITab
        value={`session:${tab.id}`}
        aria-label={tab.title}
        className={cn(
          "motion-fast flex min-h-0 min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent py-0 text-start transition-colors hover:bg-transparent focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 data-active:border-transparent",
          active ? "text-foreground" : "text-foreground-secondary",
          "pr-7 pl-3",
        )}
        onAuxClick={(event) => {
          // Middle-click closes, as it does in every other tab strip.
          if (event.button !== 1) return;
          event.preventDefault();
          onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Delete") {
            event.preventDefault();
            onClose();
          }
        }}
        title={tab.title}
        type="button"
      >
        <TabStatus running={running} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-body",
            active && "font-medium",
          )}
        >
          {tab.title}
        </span>
      </UITab>
      {/* Flex centering keeps the close target stable while pressed. */}
      <span className="absolute inset-y-0 right-1 flex items-center">
        <IconButton
          className={cn(
            "motion-fast size-5 rounded-sm text-foreground-secondary transition-opacity focus-visible:opacity-100 group-hover:opacity-100",
            active ? "opacity-100" : "opacity-0",
          )}
          tabIndex={active ? 0 : -1}
          label={`Close ${tab.title}`}
          onClick={onClose}
          size="sm"
        >
          <X aria-hidden="true" className="stroke-[1.6]" />
        </IconButton>
      </span>
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
        />
      ) : null}
    </div>
  );
}

/**
 * The docked panel's open chats, as a tab strip.
 *
 * Tabs share a capped width and shrink together, independently of selection
 * or title length. Chats beyond the readable minimum go into the overflow menu.
 */
export function ChatTabs({
  activeId,
  draft,
  onClose,
  onCloseDraft,
  onSelect,
  runningIds,
  tabs,
}: ChatTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const ids = tabs.map((tab) => tab.id);
  const { visibleIds, hiddenIds } = layOutTabs(ids, activeId, width, draft);
  // Once tabs reach the readable minimum, overflow must not make the remaining
  // tabs grow again. Both saved chats and the draft use this same width rule.
  const tabClassName = cn(
    "group relative flex min-w-0 flex-1 items-stretch border-border border-r",
    hiddenIds.length ? "max-w-24" : "max-w-50",
  );
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const running = (id: string) => runningIds?.has(id) ?? false;

  return (
    <TabsList
      activateOnFocus
      aria-label="Open chats"
      className="flex min-w-0 flex-1 items-stretch gap-0 overflow-hidden border-0"
      ref={listRef}
    >
      {visibleIds.map((id) => {
        const tab = byId.get(id);
        if (!tab) return null;
        const active = id === activeId;
        return (
          <Tab
            active={active}
            className={tabClassName}
            key={id}
            onClose={() => onClose(id)}
            running={running(id)}
            tab={tab}
          />
        );
      })}
      {draft ? (
        // The unsaved chat is a tab of its own so the strip does not jump when
        // the first prompt turns it into a real one.
        <div data-slot="chat-tab" className={cn(tabClassName, "bg-raised")}>
          <UITab
            value="draft"
            className={cn(
              "flex min-h-0 min-w-0 flex-1 items-center gap-1.5 border-0 py-0 pl-3 text-foreground data-active:border-transparent",
              tabs.length ? "pr-7" : "pr-3",
            )}
          >
            <SquarePen
              aria-hidden="true"
              className="size-3.5 flex-none stroke-[1.6] text-foreground-secondary"
            />
            <span className="min-w-0 flex-1 truncate font-medium text-body">
              New chat
            </span>
          </UITab>
          {/* Closing the only tab would leave the dock showing nothing, so
              the draft is closable only alongside a chat to fall back to. */}
          {tabs.length ? (
            <span className="absolute inset-y-0 right-1 flex items-center">
              <IconButton
                className="size-5 rounded-sm text-foreground-secondary"
                label="Close New chat"
                onClick={onCloseDraft}
                size="sm"
              >
                <X aria-hidden="true" className="stroke-[1.6]" />
              </IconButton>
            </span>
          ) : null}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
          />
        </div>
      ) : null}
      {hiddenIds.length ? (
        <Popover.Root open={overflowOpen} onOpenChange={setOverflowOpen}>
          <Popover.Trigger
            aria-label={`${hiddenIds.length} more open ${hiddenIds.length === 1 ? "chat" : "chats"}`}
            className="motion-fast flex h-full w-11 flex-none cursor-pointer items-center justify-center border-0 border-border border-r bg-transparent font-medium text-foreground-secondary text-xs tabular-nums transition-colors hover:bg-interaction-hover hover:text-foreground data-[popup-open]:bg-interaction-active data-[popup-open]:text-foreground"
          >
            +{hiddenIds.length}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner align="start" side="bottom">
              <Popover.Popup className="w-70 p-1.5">
                <p className="m-0 px-2 py-1.5 text-foreground-disabled text-xs">
                  Open chats not shown
                </p>
                {hiddenIds.map((id) => {
                  const tab = byId.get(id);
                  if (!tab) return null;
                  return (
                    <div
                      className="group relative flex min-h-7.5 min-w-0 items-center gap-2 rounded-md pr-7 pl-2 hover:bg-interaction-hover"
                      key={id}
                    >
                      <TabStatus running={running(id)} />
                      <button
                        className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-1 text-start text-body text-foreground"
                        onClick={() => {
                          setOverflowOpen(false);
                          onSelect(id);
                        }}
                        type="button"
                      >
                        {tab.title}
                      </button>
                      <span className="absolute inset-y-0 right-1 flex items-center">
                        <IconButton
                          className="motion-fast size-5 rounded-sm text-foreground-secondary opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                          label={`Close ${tab.title}`}
                          onClick={() => onClose(id)}
                          size="sm"
                        >
                          <X aria-hidden="true" className="stroke-[1.6]" />
                        </IconButton>
                      </span>
                    </div>
                  );
                })}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </TabsList>
  );
}
