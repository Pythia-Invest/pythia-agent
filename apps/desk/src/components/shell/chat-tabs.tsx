"use client";

import { cn, IconButton, Popover, Tab as UITab, TabsList } from "@pythia/ui";
import { FileText, SquarePen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { layOutTabs } from "./tabs-model";
import { ChatIndicator } from "./chat-indicator";

export interface ChatTab {
  id: string;
  title: string;
  sessionId?: string;
  description?: string;
  icon?: ReactNode;
}

export interface ChatTabsProps {
  kind?: "chat" | "file";
  activeId: string | null;
  onClose: (tabId: string) => void;
  onSelect: (tabId: string) => void;
  /** Sessions with runs observed by the retained browser chat owner. */
  runningIds?: ReadonlySet<string> | undefined;
  unreadIds?: ReadonlySet<string> | undefined;
  tabs: readonly ChatTab[];
}

/** A saved chat's working/unread state, or the pen of an unsent draft. */
function ChatTabIcon({
  tab,
  runningIds,
  unreadIds,
}: {
  tab: ChatTab;
  runningIds?: ReadonlySet<string> | undefined;
  unreadIds?: ReadonlySet<string> | undefined;
}) {
  if (!tab.sessionId)
    return (
      <SquarePen
        aria-hidden="true"
        className="size-3.5 shrink-0 text-foreground-secondary"
      />
    );
  return (
    <ChatIndicator
      working={runningIds?.has(tab.sessionId) ?? false}
      unread={unreadIds?.has(tab.sessionId) ?? false}
      idleIcon
    />
  );
}

function Tab({
  active,
  className,
  onClose,
  icon,
  tab,
  kind,
}: {
  active: boolean;
  className: string;
  onClose: () => void;
  icon: ReactNode;
  tab: ChatTab;
  kind: "chat" | "file";
}) {
  return (
    // A positioning context, as in the chat rows: the select button fills the
    // tab so its hover reaches both edges and Close sits on top of it.
    <div
      data-slot={kind === "file" ? "file-tab" : "chat-tab"}
      className={cn(
        className,
        active ? "bg-raised" : "bg-transparent hover:bg-interaction-hover",
      )}
    >
      <UITab
        value={kind === "file" ? `file:${tab.id}` : tab.id}
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
        title={tab.description ?? tab.title}
        type="button"
      >
        {tab.icon ??
          (kind === "file" ? (
            <FileText
              aria-hidden="true"
              className="size-3.5 shrink-0 text-foreground-secondary"
            />
          ) : (
            icon
          ))}
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
          className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground/35"
        />
      ) : null}
    </div>
  );
}

/**
 * The docked panel's open chats, as a tab strip; on a phone, the current title.
 *
 * Tabs share a capped width and shrink together, independently of selection
 * or title length. Chats beyond the readable minimum go into the overflow menu.
 */
export function ChatTabs({
  kind = "chat",
  activeId,
  onClose,
  onSelect,
  runningIds,
  unreadIds,
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
  const { visibleIds, hiddenIds } = layOutTabs(ids, activeId, width);
  // Once tabs reach the readable minimum, overflow must not make the remaining
  // tabs grow again. Both saved chats and the draft use this same width rule.
  const tabClassName = cn(
    "group relative flex min-w-0 flex-1 items-stretch border-transparent border-r",
    hiddenIds.length ? "max-w-24" : "max-w-50",
  );
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const icon = (tab: ChatTab) => (
    <ChatTabIcon runningIds={runningIds} tab={tab} unreadIds={unreadIds} />
  );

  // A phone has no room for a strip at a size a finger can hit, so its header
  // names the current chat, as a mobile app bar does; the history sheet
  // switches between chats. Both render, and the breakpoint picks one, so the
  // first paint is right before any script runs.
  const current = tabs.find((tab) => tab.id === activeId)?.title ?? "";
  return (
    <>
      {current ? (
        <h2 className="m-0 min-w-0 flex-1 self-center truncate px-4 font-medium text-body text-foreground min-[900px]:hidden">
          {current}
        </h2>
      ) : (
        <span className="flex-1 min-[900px]:hidden" />
      )}
      <TabsList
        activateOnFocus
        aria-label={kind === "file" ? "Open files" : "Open chats"}
        className="flex min-w-0 flex-1 items-stretch gap-0 overflow-hidden border-0 max-[899px]:hidden"
        ref={listRef}
      >
        {visibleIds.map((id) => {
          const tab = byId.get(id);
          if (!tab) return null;
          const active = id === activeId;
          return (
            <Tab
              active={active}
              kind={kind}
              className={tabClassName}
              key={id}
              onClose={() => onClose(id)}
              icon={icon(tab)}
              tab={tab}
            />
          );
        })}
        {hiddenIds.length ? (
          <Popover.Root open={overflowOpen} onOpenChange={setOverflowOpen}>
            <Popover.Trigger
              aria-label={`${hiddenIds.length} more open ${kind}${hiddenIds.length === 1 ? "" : "s"}`}
              className="motion-fast flex h-full w-11 flex-none cursor-pointer items-center justify-center border-0 border-border border-r bg-transparent font-medium text-foreground-secondary text-xs tabular-nums transition-colors hover:bg-interaction-hover hover:text-foreground data-[popup-open]:bg-interaction-active data-[popup-open]:text-foreground"
            >
              +{hiddenIds.length}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner align="start" side="bottom">
                <Popover.Popup className="w-70 p-1.5">
                  <p className="m-0 px-2 py-1.5 text-foreground-disabled text-xs">
                    Open {kind === "file" ? "files" : "chats"} not shown
                  </p>
                  {hiddenIds.map((id) => {
                    const tab = byId.get(id);
                    if (!tab) return null;
                    return (
                      <div
                        className="group relative flex min-h-7.5 min-w-0 items-center gap-2 rounded-md pr-7 pl-2 hover:bg-interaction-hover"
                        key={id}
                      >
                        {tab.icon ??
                          (kind === "file" ? (
                            <FileText
                              aria-hidden="true"
                              className="size-3.5 shrink-0 text-foreground-secondary"
                            />
                          ) : (
                            icon(tab)
                          ))}
                        <button
                          title={tab.description ?? tab.title}
                          className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-1 text-start text-body text-foreground"
                          onClick={() => {
                            setOverflowOpen(false);
                            onSelect(id);
                          }}
                          type="button"
                        >
                          {tab.title}
                          {tab.description ? (
                            <span className="block truncate text-foreground-secondary text-xs">
                              {tab.description}
                            </span>
                          ) : null}
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
    </>
  );
}
