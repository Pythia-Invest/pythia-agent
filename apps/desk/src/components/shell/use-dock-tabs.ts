"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HermesSession } from "@/server/types";
import type { ChatTab } from "./chat-tabs";
import { chatTitle } from "./sidebar-model";
import { closeTab, openTab } from "./tabs-model";

export interface DockTabs {
  /** The conversation the dock shows, or null for the unsaved "New chat" tab. */
  activeId: string | null;
  close: (sessionId: string) => void;
  /** Clears back to a fresh composer without closing anything. */
  draft: () => void;
  open: (sessionId: string) => void;
  tabs: readonly ChatTab[];
}

/**
 * The chats the docked panel is holding open.
 *
 * They travel with you across the desk, so opening a chat on the chat route
 * adds it to the strip too — the dock is the same desk seen from a page, not a
 * second place chats can live.
 */
export function useDockTabs(
  sessions: readonly HermesSession[],
  routeSessionId: string | null,
): DockTabs {
  /*
   * One piece of state, because closing a tab decides both which chats stay
   * open and which one the dock shows next; splitting it would make the second
   * answer depend on a value the first has already changed.
   */
  const [dock, setDock] = useState<{
    activeId: string | null;
    openIds: readonly string[];
  }>({ activeId: null, openIds: [] });

  const open = useCallback((sessionId: string) => {
    setDock((current) => ({
      activeId: sessionId,
      openIds: openTab(current.openIds, sessionId),
    }));
  }, []);
  const close = useCallback((sessionId: string) => {
    setDock((current) =>
      closeTab(current.openIds, current.activeId, sessionId),
    );
  }, []);
  const draft = useCallback(
    () => setDock((current) => ({ ...current, activeId: null })),
    [],
  );

  useEffect(() => {
    if (routeSessionId) open(routeSessionId);
  }, [open, routeSessionId]);

  // The session list is bounded and can fail independently of history.
  // Its absence is not evidence that an open native session was deleted.
  const tabs: readonly ChatTab[] = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return dock.openIds.map((id) => ({
      id,
      title: chatTitle(byId.get(id) ?? { id }),
    }));
  }, [dock.openIds, sessions]);

  return { activeId: dock.activeId, close, draft, open, tabs };
}
