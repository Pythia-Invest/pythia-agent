import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeskSidebar } from "@/components/shell/sidebar";
import {
  chatHref,
  chatTitle,
  groupChats,
  parsePinnedIds,
  serializePinnedIds,
  togglePin,
} from "@/components/shell/sidebar-model";

const sessions = [
  { id: "old", title: "Old research", last_active: 100 },
  { id: "new", title: "  Newest  ", last_active: 300 },
  { id: "mid", title: null, last_active: 200 },
];

function render(overrides: Partial<Parameters<typeof DeskSidebar>[0]> = {}) {
  return renderToStaticMarkup(
    <DeskSidebar
      activeId={null}
      onNewChat={vi.fn()}
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
    const pins = new Set(["a", "b"]);
    expect([...parsePinnedIds(serializePinnedIds(pins))]).toEqual(["a", "b"]);
    expect(parsePinnedIds(null).size).toBe(0);
    expect(parsePinnedIds("not json").size).toBe(0);
    expect(parsePinnedIds('{"a":1}').size).toBe(0);
    expect([...parsePinnedIds('["a", 1, null]')]).toEqual(["a"]);
  });
});

describe("DeskSidebar", () => {
  it("renders the wordmark, New chat, and both chat groups in order", () => {
    const markup = render();
    const order = ["Pythia", "New chat", "Pinned", "Recents"].map((text) =>
      markup.indexOf(text),
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

  it("marks the open chat as current and lists pinned chats under Pinned", () => {
    const markup = render({ activeId: "mid", pinnedIds: new Set(["old"]) });
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('href="/c/old"');
    expect(markup).not.toContain("No pinned chats.");
    expect(markup.indexOf("Old research")).toBeLessThan(
      markup.indexOf("Recents"),
    );
    expect(markup).toContain('aria-label="Unpin Old research"');
    expect(markup).toContain('aria-label="Pin Newest"');
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
});
