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

/** Matches a chat against the list filter; empty queries match everything. */
export function matchesChatQuery(session: HermesSession, query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return chatTitle(session).toLowerCase().includes(trimmed);
}

export interface ChatTimeGroup {
  label: string;
  sessions: readonly HermesSession[];
}

const DAY_MS = 86_400_000;

/**
 * Buckets chats by how recently they were active, the way the design groups
 * them. `now` is injected so the boundaries are testable and so a render does
 * not depend on when the module happened to load. Hermes reports `last_active`
 * in seconds; a session missing it sorts last under "Earlier".
 */
export function groupChatsByTime(
  sessions: readonly HermesSession[],
  now: number = Date.now(),
): readonly ChatTimeGroup[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const buckets: { label: string; after: number; sessions: HermesSession[] }[] =
    [
      { label: "Today", after: startOfToday, sessions: [] },
      { label: "Yesterday", after: startOfToday - DAY_MS, sessions: [] },
      {
        label: "Previous 7 days",
        after: startOfToday - 7 * DAY_MS,
        sessions: [],
      },
      {
        label: "Previous 30 days",
        after: startOfToday - 30 * DAY_MS,
        sessions: [],
      },
      { label: "Earlier", after: Number.NEGATIVE_INFINITY, sessions: [] },
    ];
  const ordered = [...sessions].sort((a, b) => recency(b) - recency(a));
  for (const session of ordered) {
    const activeAt = (session.last_active ?? 0) * 1000;
    const bucket =
      buckets.find((candidate) => activeAt >= candidate.after) ??
      buckets[buckets.length - 1];
    bucket?.sessions.push(session);
  }
  return buckets
    .filter((bucket) => bucket.sessions.length > 0)
    .map(({ label, sessions: grouped }) => ({ label, sessions: grouped }));
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * Compact "when was this last touched" badge for a chat row, e.g. `3h`, `2w`.
 *
 * A row carries its own age so the list stays readable when every chat falls
 * in one bucket and the group heading alone says nothing. Returns null when
 * Hermes never reported activity, so the row shows nothing rather than a
 * confident wrong answer.
 */
export function relativeActivity(
  session: HermesSession,
  now: number = Date.now(),
): string | null {
  if (!session.last_active) return null;
  const elapsed = now - session.last_active * 1000;
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  if (elapsed < WEEK_MS) return `${Math.floor(elapsed / DAY_MS)}d`;
  if (elapsed < MONTH_MS) return `${Math.floor(elapsed / WEEK_MS)}w`;
  if (elapsed < YEAR_MS) return `${Math.floor(elapsed / MONTH_MS)}mo`;
  return `${Math.floor(elapsed / YEAR_MS)}y`;
}

/** Full timestamp for the row's tooltip, where the badge is only an estimate. */
export function activityTitle(session: HermesSession): string | null {
  if (!session.last_active) return null;
  return new Date(session.last_active * 1000).toLocaleString();
}
