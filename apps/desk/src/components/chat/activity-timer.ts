"use client";

import { useEffect, useState } from "react";

export function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Time observed in this browser, never inferred from transcript timestamps. */
export function useElapsedSeconds(active: boolean, since: number) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return Math.max(0, Math.floor((now - since) / 1000));
}
