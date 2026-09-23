import type { QueryClient } from "@tanstack/react-query";
import type { DeskApi } from "./api";
import { historyToMessages } from "./chat-message";

/**
 * Query keys for everything Desk reads from Hermes through its own routes.
 * Keep them here so mutations can invalidate the right slices.
 */
export const deskKeys = {
  settings: ["settings"] as const,
  release: ["release-status"] as const,
  sessions: ["sessions"] as const,
  messages: (sessionId: string) => ["sessions", sessionId, "messages"] as const,
  models: ["models"] as const,
  capabilities: ["capabilities"] as const,
};

export const MESSAGE_PAGE_SIZE = 100;

export async function refreshMessages(
  queryClient: QueryClient,
  api: DeskApi,
  sessionId: string,
) {
  // A pre-completion request may contain an older transcript. Supersede it
  // before fetching the final native records.
  await queryClient.cancelQueries({ queryKey: deskKeys.messages(sessionId) });
  return historyToMessages(
    (await api.listMessages(sessionId, MESSAGE_PAGE_SIZE, 0)).data,
  );
}
