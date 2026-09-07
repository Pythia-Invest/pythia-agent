"use client";

import { useQuery } from "@tanstack/react-query";
import { historyToMessages } from "./chat-message";
import { useDeskApi } from "./providers";

/**
 * Query keys for everything Desk reads from Hermes through its own routes.
 * Keep them here so mutations can invalidate the right slices.
 */
export const deskKeys = {
  sessions: ["sessions"] as const,
  messages: (sessionId: string) => ["sessions", sessionId, "messages"] as const,
};

/**
 * The Hermes session list, newest first as Hermes returns it. While the list
 * cannot be fetched (Hermes restarting, Desk redeploying) the query polls
 * every few seconds so the sidebar recovers without a manual reload.
 */
export function useSessions() {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.sessions,
    queryFn: () => api.listSessions(),
    refetchInterval: (query) =>
      query.state.status === "error" ? 5_000 : false,
  });
}

/** One chat's transcript from Hermes, already folded into UI messages. */
export function useMessages(sessionId: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.messages(sessionId),
    queryFn: () => api.listMessages(sessionId),
    select: historyToMessages,
  });
}
