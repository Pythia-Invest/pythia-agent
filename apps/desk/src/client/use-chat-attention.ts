"use client";

import { type RefObject, useEffect, useSyncExternalStore } from "react";
import { useDeskChats } from "./providers";

export function useChatAttention() {
  const { attention } = useDeskChats();
  return useSyncExternalStore(
    attention.subscribe,
    attention.snapshot,
    attention.snapshot,
  );
}

/**
 * Selecting a route is insufficient: the reader must actually see its latest
 * reply. A chat can stay mounted out of sight (a background dock tab, a
 * closed sheet), so its element must be shown as well.
 */
export function useChatReading(
  sessionId: string,
  enabled: boolean,
  atLatest: boolean,
  surface: RefObject<HTMLElement | null>,
) {
  const { attention } = useDeskChats();
  useEffect(() => {
    const shown = () => {
      const element = surface.current;
      return Boolean(element?.isConnected && element.getClientRects().length);
    };
    const visible = () =>
      enabled &&
      atLatest &&
      shown() &&
      document.visibilityState === "visible" &&
      document.hasFocus();
    const unregister = attention.reader(sessionId, visible);
    const acknowledge = () => attention.read(sessionId);
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    // Showing a hidden chat again (switching back to its tab) reads it.
    const observer =
      typeof IntersectionObserver === "undefined" || !surface.current
        ? undefined
        : new IntersectionObserver(acknowledge);
    if (observer && surface.current) observer.observe(surface.current);
    return () => {
      unregister();
      observer?.disconnect();
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [attention, sessionId, enabled, atLatest, surface]);
}
