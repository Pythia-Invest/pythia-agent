import { describe, expect, it } from "vitest";
import { closeTab, layOutTabs } from "@/components/shell/tabs-model";

const ids = ["a", "b", "c"];

describe("tab layout", () => {
  it("keeps all chats available before measurement and while they fit", () => {
    for (const width of [0, 300, 900]) {
      const layout = layOutTabs(ids, "a", width);
      expect(layout.visibleIds).toEqual(ids);
      expect(layout.hiddenIds).toEqual([]);
    }
  });

  it("keeps the active chat reachable and accounts for every overflowed tab", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const layout = layOutTabs(many, "f", 340);
    expect(layout.visibleIds).toContain("f");
    expect(layout.visibleIds.length).toBeLessThan(many.length);
    expect([...layout.visibleIds, ...layout.hiddenIds].sort()).toEqual(many);
    expect(layOutTabs(ids, "c", 120).visibleIds).toEqual(["c"]);
  });
});

describe("closing tabs", () => {
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

  it("leaves no active tab when the last tab closes", () => {
    expect(closeTab(["a"], "a", "a")).toEqual({ activeId: null, openIds: [] });
  });
});
