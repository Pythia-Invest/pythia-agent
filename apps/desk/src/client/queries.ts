"use client";

import { useQuery } from "@tanstack/react-query";
import { useDeskApi } from "./providers";

/**
 * Query keys for everything Desk reads from Hermes through its own routes.
 * Keep them here so mutations can invalidate the right slices.
 */
export const deskKeys = {
  sessions: ["sessions"] as const,
  messages: (sessionId: string) => ["sessions", sessionId, "messages"] as const,
};

/** The Hermes session list, newest first as Hermes returns it. */
export function useSessions() {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.sessions,
    queryFn: () => api.listSessions(),
  });
}
