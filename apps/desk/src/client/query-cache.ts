import type { QueryClient } from "@tanstack/react-query";
import type { DeskApi } from "./api";
import { historyToMessages } from "./chat-message";
import type { DeskUIMessage } from "./chat-message";
import type { HermesMessage } from "@/server/types";

/**
 * Query keys for everything Desk reads from Hermes through its own routes.
 * Keep them here so mutations can invalidate the right slices.
 */
export const deskKeys = {
  settings: ["settings"] as const,
  topBar: ["desk-top-bar"] as const,
  plugins: ["plugin"] as const,
  release: ["release-status"] as const,
  /** The last remote check's answer, which local status reads don't carry. */
  releaseCheck: ["release-check"] as const,
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
  accepts: (history: DeskUIMessage[]) => boolean = () => true,
) {
  // A pre-completion request may contain an older transcript. Supersede it
  // before fetching the final native records.
  await queryClient.cancelQueries({ queryKey: deskKeys.messages(sessionId) });
  let rows: HermesMessage[] = [];
  let history: DeskUIMessage[] = [];
  // A single research turn can exceed one page. Read back to its submitted
  // user boundary, with a fixed bound rather than loading the whole session.
  for (
    let offset = 0;
    offset < MESSAGE_PAGE_SIZE * 10;
    offset += MESSAGE_PAGE_SIZE
  ) {
    const page = await api.listMessages(sessionId, MESSAGE_PAGE_SIZE, offset);
    const known = new Set(rows.map((row) => row.id));
    rows = [...page.data.filter((row) => !known.has(row.id)), ...rows];
    history = historyToMessages(rows);
    if (accepts(history) || page.returned < page.limit) break;
  }
  return history;
}
