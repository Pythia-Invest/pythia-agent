import type { HermesSession } from "@/server/types";

export const PINNED_STORAGE_KEY = "pythia-desk.pinned-chats";

/** Route of an existing chat; the shell reads the id back from the URL. */
export function chatHref(sessionId: string) {
  return `/c/${encodeURIComponent(sessionId)}`;
}

/** Visible chat title; Hermes may leave a session untitled. */
export function chatTitle(session: HermesSession) {
  return session.title?.trim() || "Untitled chat";
}

function recency(session: HermesSession) {
  return session.last_active ?? 0;
}

/**
 * Splits Hermes sessions into the pinned and recent groups the sidebar shows.
 * Both groups are newest first. Pins that no longer match a session are
 * ignored rather than rendered as empty rows.
 */
export function groupChats(
  sessions: readonly HermesSession[],
  pinnedIds: ReadonlySet<string>,
) {
  const ordered = [...sessions].sort((a, b) => recency(b) - recency(a));
  return {
    pinned: ordered.filter((session) => pinnedIds.has(session.id)),
    recents: ordered.filter((session) => !pinnedIds.has(session.id)),
  };
}

export function togglePin(pinnedIds: ReadonlySet<string>, sessionId: string) {
  const next = new Set(pinnedIds);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

/** Parses the stored pin list, tolerating absent or corrupted storage. */
export function parsePinnedIds(stored: string | null) {
  if (!stored) return new Set<string>();
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(
      parsed.filter((item): item is string => typeof item === "string"),
    );
  } catch {
    return new Set<string>();
  }
}

export function serializePinnedIds(pinnedIds: ReadonlySet<string>) {
  return JSON.stringify([...pinnedIds]);
}
