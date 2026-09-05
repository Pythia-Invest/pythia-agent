import { readFile } from "node:fs/promises";
import * as publicUi from "../src/index";
import { describe, expect, it } from "vitest";

const approvedRuntimeExports = [
  "Button",
  "ButtonGroup",
  "IconButton",
  "LinkButton",
  "Toggle",
  "ToggleGroup",
  "Input",
  "Textarea",
  "Label",
  "Field",
  "InputGroup",
  "OTPField",
  "Calendar",
  "DatePicker",
  "Checkbox",
  "Radio",
  "RadioGroup",
  "Switch",
  "Select",
  "Combobox",
  "Command",
  "Tabs",
  "Breadcrumb",
  "Pagination",
  "NavigationMenu",
  "Sidebar",
  "Dialog",
  "AlertDialog",
  "Drawer",
  "Sheet",
  "Popover",
  "Tooltip",
  "PreviewCard",
  "HoverCard",
  "Menu",
  "DropdownMenu",
  "ContextMenu",
  "Accordion",
  "Collapsible",
  "Details",
  "Alert",
  "Badge",
  "Progress",
  "Skeleton",
  "ActivityIndicator",
  "PythiaToastProvider",
  "pythiaToast",
  "Card",
  "Table",
  "Avatar",
  "ScrollArea",
  "Separator",
  "EmptyState",
  "Container",
  "Stack",
  "Inline",
  "ResizableGroup",
  "ResizablePanel",
  "ResizableSeparator",
  "Citation",
  "SourceMetadata",
  "Provenance",
  "EpistemicLabel",
  "FinancialValue",
  "MarketDirection",
  "FreshnessLabel",
  "PythiaSignal",
  "SemanticMessage",
  "KnowledgeState",
] as const;

const categoryIndexes = [
  "actions",
  "calendar",
  "data-display",
  "disclosure",
  "feedback",
  "forms",
  "layout",
  "navigation",
  "overlays",
  "selection",
  "semantics",
] as const;

const componentStyles = [
  "./lockup.css",
  "./selection/selection.css",
  "./navigation/navigation.css",
  "./overlays/overlays.css",
  "./disclosure/disclosure.css",
  "./feedback/feedback.css",
  "./data-display/data-display.css",
  "./layout/layout.css",
] as const;

describe("@pythia/ui public integration", () => {
  it("exports every approved component family from the package root", () => {
    for (const exportName of approvedRuntimeExports) {
      expect(publicUi, exportName).toHaveProperty(exportName);
    }
  });

  it("keeps the root barrel server-compatible and routes through cohesive category indexes", async () => {
    const rootIndex = await readFile(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );

    expect(rootIndex).not.toMatch(/^"use client";/);
    for (const category of categoryIndexes) {
      expect(rootIndex).toContain(`export * from "./${category}";`);
      const categoryIndex = await readFile(
        new URL(`../src/${category}/index.ts`, import.meta.url),
        "utf8",
      );
      expect(categoryIndex).not.toMatch(/import\s+["'][^"']+\.css["']/);
    }
  });

  it("loads every package component stylesheet from the canonical CSS entry only", async () => {
    const styles = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    for (const stylesheet of componentStyles) {
      expect(
        styles.match(new RegExp(`@import "${stylesheet}";`, "g")),
      ).toHaveLength(1);
    }
  });
});
