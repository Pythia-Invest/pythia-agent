import { readFile } from "node:fs/promises";
import {
  catalogCategories,
  catalogEntryByRoute,
  catalogProfiles,
  componentCatalog,
  type CatalogCategory,
} from "../src/catalog";
import { describe, expect, it } from "vitest";

const expectedNamesByCategory = {
  actions: [
    "Button",
    "Icon button",
    "Button group",
    "Link button",
    "Toggle",
    "Toggle group",
  ],
  forms: ["Input", "Textarea", "Label", "Field", "Input group", "OTP field"],
  calendar: ["Calendar", "Date picker"],
  selection: [
    "Checkbox",
    "Radio group",
    "Switch",
    "Select",
    "Combobox",
    "Command",
  ],
  navigation: [
    "Tabs",
    "Breadcrumb",
    "Pagination",
    "Navigation menu",
    "Sidebar",
  ],
  overlays: [
    "Dialog",
    "Alert dialog",
    "Drawer / sheet",
    "Popover",
    "Tooltip",
    "Preview / hover card",
    "Dropdown / menu",
    "Context menu",
  ],
  disclosure: ["Accordion", "Collapsible", "Details"],
  feedback: [
    "Alert",
    "Badge",
    "Progress",
    "Skeleton",
    "Activity indicator",
    "Toast",
  ],
  "data-display": [
    "Card",
    "Table",
    "Avatar",
    "Scroll area",
    "Separator",
    "Empty state",
  ],
  layout: ["Container", "Stack", "Inline", "Resizable panels"],
  semantics: [
    "Citation",
    "Source metadata",
    "Provenance",
    "Epistemic label",
    "Financial value",
    "Market direction",
    "Freshness label",
    "Pythia signal",
    "Semantic message",
    "Knowledge state",
  ],
} as const satisfies Record<CatalogCategory, readonly string[]>;

describe("Design Lab component catalog", () => {
  it("covers every approved top-level component family", () => {
    expect(componentCatalog).toHaveLength(62);
    expect(Object.keys(expectedNamesByCategory)).toEqual(catalogCategories);

    for (const category of catalogCategories) {
      expect(
        componentCatalog
          .filter((entry) => entry.category === category)
          .map((entry) => entry.name),
      ).toEqual(expectedNamesByCategory[category]);
    }
  });

  it("uses stable collision-free component routes with a complete lookup", () => {
    const routes = componentCatalog.map((entry) => entry.route);

    expect(new Set(routes).size).toBe(routes.length);
    for (const entry of componentCatalog) {
      expect(entry.route).toMatch(/^\/components\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(catalogEntryByRoute.get(entry.route)).toBe(entry);
    }
    expect(catalogEntryByRoute.size).toBe(componentCatalog.length);
  });

  it("uses only allowed closed profile values", () => {
    for (const entry of componentCatalog) {
      expect(entry.profiles.length).toBeGreaterThan(0);
      expect(new Set(entry.profiles).size).toBe(entry.profiles.length);
      for (const profile of entry.profiles) {
        expect(catalogProfiles).toContain(profile);
      }
    }
  });

  it("contains metadata only and no component, demo, docs, or product-data registry", async () => {
    for (const entry of componentCatalog) {
      expect(Object.keys(entry).sort()).toEqual([
        "category",
        "name",
        "profiles",
        "route",
        "search",
      ]);
    }

    const source = await readFile(
      new URL("../src/catalog.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain('from "@pythia/ui"');
    expect(source).not.toMatch(
      /\b(?:component|demo|description|docs|example|fixture|maturity|productData|render|schema):/,
    );
  });
});
