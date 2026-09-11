import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "@pythia/ui";
import { ChatTabs } from "@/components/shell/chat-tabs";
import { closeTab, layOutTabs, openTab } from "@/components/shell/tabs-model";

const tabs = [
  { id: "a", title: "Northwind dividend cover" },
  { id: "b", title: "EU allowance resets" },
  { id: "c", title: "Semis capex cycle" },
];

const ids = tabs.map((tab) => tab.id);

function render(overrides: Partial<Parameters<typeof ChatTabs>[0]> = {}) {
  return renderToStaticMarkup(
    <Tabs
      value={overrides.draft ? "draft" : `session:${overrides.activeId ?? "a"}`}
    >
      <ChatTabs
        activeId="a"
        draft={false}
        onClose={vi.fn()}
        onCloseDraft={vi.fn()}
        onSelect={vi.fn()}
        tabs={tabs}
        {...overrides}
      />
    </Tabs>,
  );
}

describe("tab layout", () => {
  it("keeps all chats available before measurement and while they fit", () => {
    for (const width of [0, 300, 900]) {
      const layout = layOutTabs(ids, "a", width, false);
      expect(layout.visibleIds).toEqual(ids);
      expect(layout.hiddenIds).toEqual([]);
    }
  });

  it("keeps the active chat reachable and accounts for every overflowed tab", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const layout = layOutTabs(many, "f", 340, false);
    expect(layout.visibleIds).toContain("f");
    expect(layout.visibleIds.length).toBeLessThan(many.length);
    expect([...layout.visibleIds, ...layout.hiddenIds].sort()).toEqual(many);
    expect(layOutTabs(ids, "c", 120, false).visibleIds).toEqual(["c"]);
  });

  it("reserves a tab for the unsaved chat, including in a narrow dock", () => {
    const saved = layOutTabs(ids, "c", 300, false);
    const draft = layOutTabs(ids, null, 300, true);
    expect(draft.visibleIds.length).toBeLessThan(saved.visibleIds.length);
    expect([...draft.visibleIds, ...draft.hiddenIds].sort()).toEqual(ids);
    expect(layOutTabs(ids, null, 120, true)).toEqual({
      visibleIds: [],
      hiddenIds: ids,
    });
  });
});

describe("opening and closing tabs", () => {
  it("appends a chat once, however often it is opened", () => {
    expect(openTab(ids, "d")).toEqual(["a", "b", "c", "d"]);
    expect(openTab(ids, "b")).toBe(ids);
  });

  it("hands the dock the neighbouring tab when the active one closes", () => {
    expect(closeTab(ids, "b", "b")).toEqual({
      activeId: "c",
      openIds: ["a", "c"],
    });
    // The last tab has no tab after it, so the one before takes over.
    expect(closeTab(ids, "c", "c").activeId).toBe("b");
  });

  it("leaves the active chat alone when another tab closes", () => {
    expect(closeTab(ids, "a", "c")).toEqual({
      activeId: "a",
      openIds: ["a", "b"],
    });
  });

  it("falls back to a fresh composer when the last tab closes", () => {
    expect(closeTab(["a"], "a", "a")).toEqual({ activeId: null, openIds: [] });
  });
});

describe("ChatTabs", () => {
  it("marks the active tab and offers to close each one", () => {
    const markup = render();
    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(tabs.length);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-label="Close Northwind dividend cover"');
  });

  it("shows an unsaved chat as its own tab", () => {
    const markup = render({ activeId: null, draft: true, tabs: [] });
    expect(markup).toContain("New chat");
    // Nothing to fall back to, so closing the lone draft is not offered.
    expect(markup).not.toContain('aria-label="Close New chat"');
  });

  it("lets the unsaved chat be closed once another tab can take over", () => {
    const markup = render({ activeId: null, draft: true });
    expect(markup).toContain('aria-label="Close New chat"');
  });
});
