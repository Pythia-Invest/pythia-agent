import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/shell/chat-panel";
import {
  chatHref,
  chatTitle,
  groupChats,
  groupChatsByTime,
  matchesChatQuery,
  parsePinnedIds,
  relativeActivity,
  serializePinnedIds,
  togglePin,
} from "@/components/shell/sidebar-model";

/** Fixed clock so the time buckets do not drift with the wall clock. */
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
const startOfToday = new Date(NOW).setHours(0, 0, 0, 0);
const DAY = 86_400_000;
const secondsAt = (ms: number) => Math.floor(ms / 1000);

const sessions = [
  { id: "old", title: "Old research", last_active: 100 },
  { id: "new", title: "  Newest  ", last_active: 300 },
  { id: "mid", title: null, last_active: 200 },
];

function render(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ChatPanel
      activeId={null}
      onNewChat={vi.fn()}
      onRename={vi.fn(async () => undefined)}
      onTogglePin={vi.fn()}
      pinnedIds={new Set()}
      sessions={sessions}
      state="ready"
      {...overrides}
    />,
  );
}

describe("sidebar model", () => {
  it("orders chats newest first and separates pinned ones", () => {
    const groups = groupChats(sessions, new Set(["old", "missing"]));
    expect(groups.pinned.map((s) => s.id)).toEqual(["old"]);
    expect(groups.recents.map((s) => s.id)).toEqual(["new", "mid"]);
  });

  it("routes each chat to its own path with the id encoded", () => {
    expect(chatHref("abc")).toBe("/c/abc");
    expect(chatHref("a/b c")).toBe("/c/a%2Fb%20c");
  });

  it("falls back to a neutral title for untitled sessions", () => {
    expect(chatTitle({ id: "a", title: "  Newest  " })).toBe("Newest");
    expect(chatTitle({ id: "b", title: "   " })).toBe("Untitled chat");
    expect(chatTitle({ id: "c" })).toBe("Untitled chat");
  });

  it("toggles pins without mutating the previous set", () => {
    const initial = new Set(["a"]);
    const added = togglePin(initial, "b");
    expect([...added]).toEqual(["a", "b"]);
    expect([...togglePin(added, "a")]).toEqual(["b"]);
    expect([...initial]).toEqual(["a"]);
  });

  it("round-trips stored pins and tolerates corrupt storage", () => {
    const stored = serializePinnedIds(new Set(["a", "b"]));
    expect([...parsePinnedIds(stored)]).toEqual(["a", "b"]);
    expect([...parsePinnedIds(null)]).toEqual([]);
    expect([...parsePinnedIds("not json")]).toEqual([]);
    expect([...parsePinnedIds('{"a":1}')]).toEqual([]);
    expect([...parsePinnedIds('["a",2]')]).toEqual(["a"]);
  });

  it("matches the chat filter on the visible title", () => {
    const session = { id: "a", title: "Northwind dividend cover" };
    expect(matchesChatQuery(session, "")).toBe(true);
    expect(matchesChatQuery(session, "  ")).toBe(true);
    expect(matchesChatQuery(session, "DIVIDEND")).toBe(true);
    expect(matchesChatQuery(session, "semis")).toBe(false);
    expect(matchesChatQuery({ id: "b" }, "untitled")).toBe(true);
  });

  it("buckets chats by recency and drops empty buckets", () => {
    const groups = groupChatsByTime(
      [
        { id: "today", last_active: secondsAt(startOfToday + 3600_000) },
        { id: "yesterday", last_active: secondsAt(startOfToday - DAY + 1000) },
        { id: "week", last_active: secondsAt(startOfToday - 3 * DAY) },
        { id: "ancient", last_active: secondsAt(startOfToday - 400 * DAY) },
        { id: "unknown" },
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "Previous 7 days",
      "Earlier",
    ]);
    expect(groups.at(-1)?.sessions.map((s) => s.id)).toEqual([
      "ancient",
      "unknown",
    ]);
  });

  it("abbreviates how long ago a chat was last active", () => {
    const at = (ms: number) => ({ id: "a", last_active: secondsAt(NOW - ms) });
    expect(relativeActivity(at(5_000), NOW)).toBe("now");
    expect(relativeActivity(at(9 * 60_000), NOW)).toBe("9m");
    expect(relativeActivity(at(5 * 3_600_000), NOW)).toBe("5h");
    expect(relativeActivity(at(3 * DAY), NOW)).toBe("3d");
    expect(relativeActivity(at(20 * DAY), NOW)).toBe("2w");
    expect(relativeActivity(at(90 * DAY), NOW)).toBe("3mo");
    expect(relativeActivity(at(800 * DAY), NOW)).toBe("2y");
    expect(relativeActivity({ id: "b" }, NOW)).toBeNull();
  });
});

describe("ChatPanel", () => {
  it("leads the header with New chat and groups the list below it", () => {
    const markup = render();
    const order = ["New chat", "Search chats", "Pinned", "Recents"].map(
      (text) => markup.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(markup).toContain("No pinned chats.");
    expect(markup.indexOf("Newest")).toBeLessThan(
      markup.indexOf("Untitled chat"),
    );
    expect(markup.indexOf("Untitled chat")).toBeLessThan(
      markup.indexOf("Old research"),
    );
  });

  it("marks the open chat as current and lists pinned chats first", () => {
    const markup = render({ activeId: "mid", pinnedIds: new Set(["old"]) });
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('href="/c/old"');
    expect(markup).not.toContain("No pinned chats.");
    expect(markup.indexOf("Old research")).toBeLessThan(
      markup.indexOf("Newest"),
    );
    expect(markup).toContain('aria-label="Chat actions for Old research"');
    expect(markup).toContain('aria-label="Chat actions for Newest"');
  });

  it("explains loading and unavailable states instead of showing an empty list", () => {
    const loading = render({ sessions: [], state: "loading" });
    expect(loading).toContain("Loading chats…");
    expect(loading).toContain('aria-busy="true"');
    expect(loading.match(/data-slot="skeleton"/g)).toHaveLength(7);
    expect(loading).not.toContain("No chats yet.");
    expect(render({ sessions: [], state: "unavailable" })).toContain(
      "Hermes is offline",
    );
    const stale = render({ state: "unavailable" });
    expect(stale).toContain("Showing the last chat list");
    expect(stale).toContain("Newest");
    expect(render({ sessions: [] })).toContain("No chats yet.");
  });

  it("only offers to hide the list when the shell can bring it back", () => {
    expect(render()).not.toContain("Hide chats");
    expect(render({ onHide: vi.fn() })).toContain("Hide chats");
  });

  it("keeps search behind an icon until it is asked for", () => {
    const markup = render();
    // The affordance is there; the field is not taking up the header row.
    expect(markup).toContain('aria-label="Search chats"');
    expect(markup).not.toContain('placeholder="Search chats"');
  });

  it("names the unpinned region so the break after Pinned reads", () => {
    const markup = render();
    expect(markup.indexOf("Pinned")).toBeLessThan(markup.indexOf("Recents"));
    // Every fixture chat is ancient, so one bucket carries them all and its
    // own date label would add nothing over "Recents".
    expect(markup).toMatch(/class="[^"]*sr-only[^"]*"[^>]*>\s*Earlier/u);
  });

  it("narrows the list with the shell-wide query as well as its own", () => {
    const markup = render({ globalQuery: "Newest" });
    expect(markup).toContain("Newest");
    expect(markup).not.toContain("Old research");
  });
});
