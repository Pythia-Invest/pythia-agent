"use client";

import {
  cn,
  SidebarList,
  SidebarSection,
  SidebarSectionLabel,
  Skeleton,
} from "@pythia/ui";
import type { Pin } from "lucide-react";
import type { HermesSession } from "@/server/types";
import { ChatRow } from "./chat-row";

/** Same height as a chat row so the list does not jump when chats arrive. */
export function ChatRowSkeletons({ count }: { count: number }) {
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {Array.from({ length: count }, (_, index) => (
        <li className="flex min-h-7 items-center px-2" key={index}>
          <Skeleton
            className="h-3"
            shape="block"
            style={{ width: `${72 - (index % 3) * 14}%` }}
          />
        </li>
      ))}
    </ul>
  );
}

export function GroupLabel({
  children,
  icon: Icon,
  id,
  tone = "section",
  visible,
}: {
  children: string;
  icon?: typeof Pin | undefined;
  id: string;
  /** A section names a region of the list; a bucket dates rows inside one. */
  tone?: "section" | "bucket" | undefined;
  visible: boolean;
}) {
  return (
    <SidebarSectionLabel
      className={cn(
        "flex items-center gap-1.5 px-2 text-xs",
        tone === "section"
          ? "min-h-6.5 pt-3 pb-1 font-medium text-foreground-secondary"
          : "min-h-5.5 pt-2 pb-0.5 font-normal text-foreground-disabled",
        !visible && "sr-only",
      )}
      id={id}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="size-3.5 flex-none stroke-[1.6]" />
      ) : null}
      {children}
    </SidebarSectionLabel>
  );
}

export function ChatGroup({
  activeId,
  emptyText,
  heading,
  icon,
  now,
  onSelect,
  onTogglePin,
  onRename,
  pinnedIds,
  sessions,
  showHeading = true,
  skeletonRows = 0,
  tone,
}: {
  activeId: string | null;
  emptyText?: string | null | undefined;
  heading: string;
  icon?: typeof Pin | undefined;
  now: number | null;
  tone?: "section" | "bucket" | undefined;
  onSelect?: ((sessionId: string) => void) | undefined;
  onTogglePin: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
  pinnedIds: ReadonlySet<string>;
  sessions: readonly HermesSession[];
  showHeading?: boolean;
  skeletonRows?: number;
}) {
  const headingId = `desk-chats-${heading.toLowerCase().replace(/\W+/gu, "-")}`;
  return (
    <SidebarSection aria-labelledby={headingId} className="gap-0 py-0">
      <GroupLabel icon={icon} id={headingId} tone={tone} visible={showHeading}>
        {heading}
      </GroupLabel>
      {skeletonRows > 0 ? (
        <ChatRowSkeletons count={skeletonRows} />
      ) : sessions.length ? (
        <SidebarList className="gap-0.5">
          {sessions.map((session) => (
            <ChatRow
              active={session.id === activeId}
              key={session.id}
              now={now}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
              onRename={onRename}
              pinned={pinnedIds.has(session.id)}
              session={session}
            />
          ))}
        </SidebarList>
      ) : emptyText ? (
        <p className="m-0 px-2 py-1 text-body text-foreground-disabled leading-ui">
          {emptyText}
        </p>
      ) : null}
    </SidebarSection>
  );
}
