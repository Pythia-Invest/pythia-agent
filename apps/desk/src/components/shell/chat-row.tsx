"use client";

/*
 * Absolutely positioned controls are centred with `inset-y-0 … my-auto`, never
 * `top-1/2 -translate-y-1/2`: the shared button recipe nudges itself down on
 * :active, which overwrites a translate-based centring and slides the target
 * out from under the pointer between press and release, so the click never
 * lands.
 */

import {
  cn,
  IconButton,
  Menu,
  SidebarButton,
  SidebarItem,
  SidebarLink,
} from "@pythia/ui";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { HermesSession } from "@/server/types";
import {
  activityTitle,
  chatHref,
  chatTitle,
  relativeActivity,
} from "./sidebar-model";

export interface ChatRowProps {
  active: boolean;
  now: number | null;
  onRename: (sessionId: string, title: string) => Promise<void>;
  onTogglePin: (sessionId: string) => void;
  /**
   * Selects the chat in place instead of routing to it. The docked panel uses
   * this so picking a conversation does not navigate away from the page.
   */
  onSelect?: ((sessionId: string) => void) | undefined;
  pinned: boolean;
  session: HermesSession;
}

/**
 * One chat in the list: title, how long since it was last active, actions.
 *
 * The age badge and the actions share the right edge — the badge answers "is
 * this the one I want" at rest, and steps aside for the menu on hover so the
 * row never grows two competing affordances. `now` is passed in and starts
 * null so the server and the first client render agree.
 */
export function ChatRow({
  active,
  now,
  onRename,
  onSelect,
  onTogglePin,
  pinned,
  session,
}: ChatRowProps) {
  const title = chatTitle(session);
  const href = chatHref(session.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) renameRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <SidebarItem className="px-1 py-0.5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = draft.trim();
            if (!next) return;
            void onRename(session.id, next).then(() => setEditing(false));
          }}
        >
          <input
            aria-label={`Rename ${title}`}
            className="h-7 w-full rounded-md border border-border-strong bg-raised px-2 text-body text-foreground outline-2 outline-ring"
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(title);
                setEditing(false);
              }
            }}
            ref={renameRef}
            value={draft}
          />
        </form>
      </SidebarItem>
    );
  }

  const age = now === null ? null : relativeActivity(session, now);
  const fullTimestamp = activityTitle(session);

  return (
    <SidebarItem className="group relative min-w-0">
      {/* Same row treatment either way; only what activating it does differs. */}
      {onSelect ? (
        <SidebarButton
          className="min-h-7 rounded-md py-0 pr-8 pl-2 font-normal text-body text-foreground data-active:font-medium"
          data-active={active ? "" : undefined}
          onClick={() => onSelect(session.id)}
          title={title}
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </SidebarButton>
      ) : (
        <SidebarLink
          active={active}
          className="min-h-7 rounded-md py-0 pr-8 pl-2 font-normal text-body text-foreground data-active:font-medium"
          render={<Link href={href} />}
          title={title}
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </SidebarLink>
      )}
      {age ? (
        <span
          className="motion-fast pointer-events-none absolute inset-y-0 right-2 my-auto h-4 text-foreground-disabled text-xs tabular-nums transition-opacity group-focus-within:opacity-0 group-hover:opacity-0"
          title={fullTimestamp ?? undefined}
        >
          {age}
        </span>
      ) : null}
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              className={cn(
                "absolute inset-y-0 right-1 my-auto size-5.5 rounded-sm text-foreground-secondary opacity-0 transition-opacity",
                "focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100",
              )}
              label={`Chat actions for ${title}`}
              onClick={(event) => event.stopPropagation()}
              size="sm"
            >
              <MoreHorizontal aria-hidden="true" className="stroke-[1.6]" />
            </IconButton>
          }
        />
        <Menu.Portal>
          <Menu.Positioner align="end" side="right">
            <Menu.Popup>
              <Menu.Item onClick={() => setEditing(true)}>Rename</Menu.Item>
              <Menu.Item onClick={() => onTogglePin(session.id)}>
                {pinned ? "Unpin" : "Pin"}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </SidebarItem>
  );
}
