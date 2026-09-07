import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = async (path: string) =>
  readFile(new URL(path, import.meta.url), "utf8");

describe("overlay and disclosure styling contract", () => {
  it("uses semantic theme names without a component palette", async () => {
    const overlays = await source("../src/overlays/shared.ts");
    const drawer = await source("../src/overlays/drawer.tsx");
    const disclosure = await source("../src/disclosure/shared.ts");
    const accordion = await source("../src/disclosure/accordion.tsx");

    expect(overlays).toContain("bg-overlay");
    expect(overlays).toContain("min-h-control");
    expect(overlays).toContain("hover:bg-interaction-hover");
    expect(accordion).toContain("border-border");
    expect(disclosure).toContain("text-body");
    for (const file of [overlays, drawer, disclosure, accordion]) {
      expect(file).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(file).not.toContain("--py-color-");
    }
  });

  it("styles exact Base UI 1.7.0 states and drawer movement variables", async () => {
    const drawer = await source("../src/overlays/drawer.tsx");
    const menu = await source("../src/overlays/menu.tsx");
    const overlays = await source("../src/overlays/shared.ts");
    const accordion = await source("../src/disclosure/accordion.tsx");
    const collapsible = await source("../src/disclosure/collapsible.tsx");

    expect(drawer).toContain("data-[swipe-direction=down]");
    expect(drawer).toContain("--drawer-swipe-movement-x");
    expect(drawer).toContain("--drawer-swipe-movement-y");
    expect(drawer).toContain("--drawer-snap-point-offset");
    expect(menu).toContain("data-highlighted:");
    expect(overlays).toContain("data-starting-style:");
    expect(accordion).toContain("--accordion-panel-height");
    expect(collapsible).toContain("--collapsible-panel-height");
    expect(accordion).toContain("group-data-panel-open:rotate-180");
  });

  it("limits shadows to genuinely elevated popup surfaces", async () => {
    const overlays = await source("../src/overlays/shared.ts");
    const disclosureFiles = await Promise.all(
      ["shared.ts", "accordion.tsx", "collapsible.tsx", "details.tsx"].map(
        (file) => source(`../src/disclosure/${file}`),
      ),
    );

    // One elevated surface recipe carries the overlay shadow; nothing else in the family adds one.
    expect(overlays.match(/shadow-/g)).toHaveLength(1);
    expect(overlays).toContain("bg-overlay text-foreground shadow-overlay");
    for (const file of disclosureFiles) {
      expect(file).not.toContain("shadow");
    }
  });
});
