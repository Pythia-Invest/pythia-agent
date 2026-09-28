"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useDeskChats } from "./providers";

export function useChatAttention() {
  const { attention } = useDeskChats();
  return useSyncExternalStore(
    attention.subscribe,
    attention.snapshot,
    attention.snapshot,
  );
}

/** Selecting a route is insufficient: the reader must actually see its latest reply. */
export function useChatReading(
  sessionId: string,
  enabled: boolean,
  atLatest: boolean,
) {
  const { attention } = useDeskChats();
  useEffect(() => {
    const visible = () =>
      enabled &&
      atLatest &&
      document.visibilityState === "visible" &&
      document.hasFocus();
    const unregister = attention.reader(sessionId, visible);
    const acknowledge = () => attention.read(sessionId);
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      unregister();
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [attention, sessionId, enabled, atLatest]);
}
