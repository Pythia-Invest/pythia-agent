"use client";

import {
  cn,
  IconButton,
  Sidebar,
  SidebarButton,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLink,
  SidebarList,
  SidebarNav,
  SidebarSection,
  SidebarSectionLabel,
  useThemePreference,
} from "@pythia/ui";
import {
  type LucideIcon,
  Moon,
  Pin,
  PinOff,
  SquarePen,
  Sun,
} from "lucide-react";
import Link from "next/link";
import type { HermesSession } from "@/server/types";
import { chatHref, chatTitle, groupChats } from "./sidebar-model";

/**
 * Fixed app destinations shown under the wordmark. "New chat" is the first
 * entry; the remaining sections are still to be decided, so add them here.
 */
const destinations: readonly {
  id: "new-chat";
  label: string;
  icon: LucideIcon;
}[] = [{ id: "new-chat", label: "New chat", icon: SquarePen }];

export type ChatListState = "loading" | "ready" | "unavailable";

export interface DeskSidebarProps {
  activeId: string | null;
  className?: string;
  id?: string;
  onNewChat: () => void;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  sessions: readonly HermesSession[];
  state: ChatListState;
}

function ChatRow({
  active,
  onTogglePin,
  pinned,
  session,
}: {
  active: boolean;
  onTogglePin: (sessionId: string) => void;
  pinned: boolean;
  session: HermesSession;
}) {
  const title = chatTitle(session);
  const href = chatHref(session.id);
  return (
    <SidebarItem className="group relative min-w-0">
      <SidebarLink
        active={active}
        // The pin control needs room on hover, focus, and on touch screens where it is always shown.
        className="min-h-9 px-3 font-normal text-foreground group-focus-within:pr-10 group-hover:pr-10 data-active:font-medium max-md:pr-10"
        render={<Link href={href} />}
        title={title}
      >
        <span className="min-w-0 truncate">{title}</span>
      </SidebarLink>
      <IconButton
        className="absolute top-1/2 right-1 -translate-y-1/2 bg-canvas opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
        label={pinned ? `Unpin ${title}` : `Pin ${title}`}
        onClick={() => onTogglePin(session.id)}
        size="sm"
      >
        {pinned ? <PinOff /> : <Pin />}
      </IconButton>
    </SidebarItem>
  );
}

function ChatGroup({
  activeId,
  emptyText,
  heading,
  onTogglePin,
  pinnedIds,
  sessions,
}: {
  activeId: string | null;
  emptyText: string | null;
  heading: string;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  sessions: readonly HermesSession[];
}) {
  const headingId = `desk-${heading.toLowerCase()}-heading`;
  return (
    <SidebarSection aria-labelledby={headingId} className="gap-0 py-0">
      <SidebarSectionLabel className="px-3 pt-2 pb-1" id={headingId}>
        {heading}
      </SidebarSectionLabel>
      {sessions.length ? (
        <SidebarList className="gap-0.5">
          {sessions.map((session) => (
            <ChatRow
              active={session.id === activeId}
              key={session.id}
              onTogglePin={onTogglePin}
              pinned={pinnedIds.has(session.id)}
              session={session}
            />
          ))}
        </SidebarList>
      ) : emptyText ? (
        <p className="m-0 px-3 py-2 text-foreground-disabled text-sm leading-ui">
          {emptyText}
        </p>
      ) : null}
    </SidebarSection>
  );
}

function ThemeToggle() {
  const theme = useThemePreference();
  const dark = theme.resolvedTheme === "dark";
  return (
    <IconButton
      label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => theme.setPreference(dark ? "light" : "dark")}
      size="sm"
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}

/** Left navigation: wordmark, app destinations, pinned chats, recent chats. */
export function DeskSidebar({
  activeId,
  className,
  id,
  onNewChat,
  onTogglePin,
  pinnedIds,
  sessions,
  state,
}: DeskSidebarProps) {
  const { pinned, recents } = groupChats(sessions, pinnedIds);
  const recentsEmptyText =
    state === "loading"
      ? "Loading chats…"
      : state === "unavailable"
        ? "Chats are unavailable while Hermes is offline."
        : "No chats yet.";

  return (
    <Sidebar
      aria-label="Desk navigation"
      className={cn("h-dvh w-[260px] bg-canvas", className)}
      id={id}
    >
      <SidebarHeader className="flex min-h-13 items-center border-b-0 px-4 py-3">
        <span className="font-bold text-base text-foreground leading-tight tracking-normal">
          Pythia
        </span>
      </SidebarHeader>
      <SidebarContent className="grid content-start gap-4 px-2 pt-0 pb-4">
        <SidebarNav aria-label="Desk sections">
          <SidebarList>
            {destinations.map(({ icon: Icon, id: destinationId, label }) => (
              <SidebarItem key={destinationId}>
                <SidebarButton
                  className="min-h-9 px-3 font-medium text-foreground"
                  onClick={onNewChat}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-[18px] flex-none stroke-[1.75]"
                  />
                  <span>{label}</span>
                </SidebarButton>
              </SidebarItem>
            ))}
          </SidebarList>
        </SidebarNav>
        <SidebarNav aria-label="Chats">
          <ChatGroup
            activeId={activeId}
            emptyText={state === "ready" ? "No pinned chats." : null}
            heading="Pinned"
            onTogglePin={onTogglePin}
            pinnedIds={pinnedIds}
            sessions={pinned}
          />
          <ChatGroup
            activeId={activeId}
            emptyText={recentsEmptyText}
            heading="Recents"
            onTogglePin={onTogglePin}
            pinnedIds={pinnedIds}
            sessions={recents}
          />
        </SidebarNav>
      </SidebarContent>
      <SidebarFooter className="flex justify-end border-t-0 p-2">
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
