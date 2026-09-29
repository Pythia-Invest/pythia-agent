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
    // Laid out, and not covered by a layer over it (the phone chat list, a
    // full-screen file viewer): the chat itself is what sits at its centre.
    const shown = () => {
      const element = surface.current;
      if (!element?.isConnected || element.closest("[inert]")) return false;
      const box = element.getBoundingClientRect();
      const left = Math.max(box.left, 0);
      const right = Math.min(box.right, window.innerWidth);
      const top = Math.max(box.top, 0);
      const bottom = Math.min(box.bottom, window.innerHeight);
      if (right <= left || bottom <= top) return false;
      const hit = document.elementFromPoint(
        (left + right) / 2,
        (top + bottom) / 2,
      );
      return Boolean(hit && element.contains(hit));
    };
    const visible = () =>
      enabled &&
      atLatest &&
      shown() &&
      document.visibilityState === "visible" &&
      document.hasFocus();
    const unregister = attention.reader(sessionId, visible);
    const acknowledge = () => attention.read(sessionId);
    // Closing a layer is a click or a key; check again once it has gone.
    const afterInput = () => requestAnimationFrame(acknowledge);
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    document.addEventListener("click", afterInput, true);
    document.addEventListener("keyup", afterInput, true);
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
      document.removeEventListener("click", afterInput, true);
      document.removeEventListener("keyup", afterInput, true);
    };
  }, [attention, sessionId, enabled, atLatest, surface]);
}
