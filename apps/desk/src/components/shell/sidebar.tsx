"use client";

import {
  Button,
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
  Skeleton,
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
  onRetry?: () => void;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  sessions: readonly HermesSession[];
  state: ChatListState;
}

/** Same height as a chat row so the list does not jump when chats arrive. */
function ChatRowSkeletons({ count }: { count: number }) {
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {Array.from({ length: count }, (_, index) => (
        <li className="flex min-h-9 items-center px-3" key={index}>
          <Skeleton
            className="h-3.5"
            shape="block"
            style={{ width: `${72 - (index % 3) * 14}%` }}
          />
        </li>
      ))}
    </ul>
  );
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
        // Always reserve room for the pin glyph so titles neither collide with it nor re-truncate on hover.
        className="min-h-9 py-1 pr-9 pl-3 font-normal text-foreground text-sm data-active:font-medium"
        render={<Link href={href} />}
        title={title}
      >
        <span className="min-w-0 truncate">{title}</span>
      </SidebarLink>
      {/* Quiet inline affordance: no surface of its own, visible on hover, focus, or touch. */}
      <button
        aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
        className={cn(
          "motion-fast absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-control border-0 bg-transparent p-0 text-foreground-secondary transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100",
          pinned ? "opacity-100" : "opacity-0",
        )}
        onClick={() => onTogglePin(session.id)}
        type="button"
      >
        {pinned ? (
          <PinOff aria-hidden="true" className="size-3.5 stroke-[1.75]" />
        ) : (
          <Pin aria-hidden="true" className="size-3.5 stroke-[1.75]" />
        )}
      </button>
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
  skeletonRows = 0,
}: {
  activeId: string | null;
  emptyText: string | null;
  heading: string;
  onTogglePin: (sessionId: string) => void;
  pinnedIds: ReadonlySet<string>;
  sessions: readonly HermesSession[];
  skeletonRows?: number;
}) {
  const headingId = `desk-${heading.toLowerCase()}-heading`;
  return (
    <SidebarSection aria-labelledby={headingId} className="gap-0 py-0">
      <SidebarSectionLabel
        className="px-3 pt-2 pb-1 font-medium text-foreground-disabled"
        id={headingId}
      >
        {heading}
      </SidebarSectionLabel>
      {skeletonRows > 0 ? (
        <ChatRowSkeletons count={skeletonRows} />
      ) : sessions.length ? (
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
  onRetry,
  onTogglePin,
  pinnedIds,
  sessions,
  state,
}: DeskSidebarProps) {
  const { pinned, recents } = groupChats(sessions, pinnedIds);
  const loading = state === "loading";

  return (
    <Sidebar
      aria-label="Desk navigation"
      className={cn("h-dvh w-[260px] bg-canvas", className)}
      id={id}
    >
      <SidebarHeader className="flex min-h-14 items-center border-b-0 px-4 py-3">
        <span className="font-semibold text-foreground text-xl leading-tight tracking-tight">
          Pythia
        </span>
      </SidebarHeader>
      <SidebarContent className="grid content-start gap-4 px-2 pt-0 pb-4">
        <SidebarNav aria-label="Desk sections">
          <SidebarList>
            {destinations.map(({ icon: Icon, id: destinationId, label }) => (
              <SidebarItem key={destinationId}>
                <SidebarButton
                  className="min-h-9 px-3 font-normal text-foreground text-sm"
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
        <SidebarNav aria-busy={loading || undefined} aria-label="Chats">
          {loading ? <p className="sr-only">Loading chats…</p> : null}
          <ChatGroup
            activeId={activeId}
            emptyText="No pinned chats."
            heading="Pinned"
            onTogglePin={onTogglePin}
            pinnedIds={pinnedIds}
            sessions={pinned}
            skeletonRows={loading ? 1 : 0}
          />
          <ChatGroup
            activeId={activeId}
            emptyText={state === "unavailable" ? null : "No chats yet."}
            heading="Recents"
            onTogglePin={onTogglePin}
            pinnedIds={pinnedIds}
            sessions={recents}
            skeletonRows={loading ? 6 : 0}
          />
          {state === "unavailable" ? (
            <div className="grid gap-2 px-3 py-2" role="status">
              <p className="m-0 text-foreground-secondary text-sm leading-ui">
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
      </SidebarContent>
      <SidebarFooter className="flex justify-end border-t-0 p-2">
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
