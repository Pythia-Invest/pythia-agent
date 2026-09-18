"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HermesSession } from "@/server/types";
import type { NewChatDraft } from "@/components/chat/new-chat";
import { chatTitle } from "./sidebar-model";
import { closeTab } from "./tabs-model";
import { useDeskDrafts } from "@/client/providers";

export interface DockTab {
  /** UI identity survives the first send. Native session identity is separate. */
  id: string;
  sessionId?: string;
  draft: NewChatDraft;
}

/** Only open-tab/editor state lives here. Hermes owns conversations and runs. */
export function useDockTabs(
  sessions: readonly HermesSession[],
  routeSessionId: string | null,
) {
  const drafts = useDeskDrafts();
  const [dock, setDock] = useState<{
    activeId: string | null;
    tabs: readonly DockTab[];
  }>({
    activeId: "initial-draft",
    tabs: [{ id: "initial-draft", draft: {} }],
  });
  const select = useCallback((id: string) => {
    setDock((current) =>
      current.tabs.some((t) => t.id === id)
        ? { ...current, activeId: id }
        : current,
    );
  }, []);
  const open = useCallback((sessionId: string) => {
    setDock((current) => {
      const found = current.tabs.find((t) => t.sessionId === sessionId);
      const id = found?.id ?? `session:${sessionId}`;
      return {
        activeId: id,
        tabs: found
          ? current.tabs
          : [...current.tabs, { id, sessionId, draft: {} }],
      };
    });
  }, []);
  const close = useCallback(
    (id: string) => {
      drafts.clear(id);
      setDock((current) => {
        const next = closeTab(
          current.tabs.map((t) => t.id),
          current.activeId,
          id,
        );
        return {
          activeId: next.activeId,
          tabs: current.tabs.filter((t) => t.id !== id),
        };
      });
    },
    [drafts],
  );
  const draft = useCallback(() => {
    const id = `draft:${crypto.randomUUID()}`;
    setDock((current) => ({
      activeId: id,
      tabs: [...current.tabs, { id, draft: {} }],
    }));
    return id;
  }, []);
  const edit = useCallback((id: string, draft: NewChatDraft) => {
    setDock((current) => ({
      ...current,
      tabs: current.tabs.map((t) =>
        t.id === id && !t.sessionId ? { ...t, draft } : t,
      ),
    }));
  }, []);
  const started = useCallback((id: string, sessionId: string) => {
    // Late creation replaces only its own open draft without stealing focus.
    setDock((current) => ({
      ...current,
      tabs: current.tabs.map((t) =>
        t.id === id && !t.sessionId ? { ...t, sessionId, draft: {} } : t,
      ),
    }));
  }, []);
  useEffect(() => {
    if (routeSessionId) open(routeSessionId);
  }, [open, routeSessionId]);
  const tabs = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return dock.tabs.map((tab) => ({
      ...tab,
      title: tab.sessionId
        ? chatTitle(byId.get(tab.sessionId) ?? { id: tab.sessionId })
        : "New chat",
    }));
  }, [dock.tabs, sessions]);
  return {
    activeId: dock.activeId,
    tabs,
    close,
    draft,
    open,
    select,
    edit,
    started,
  };
}
