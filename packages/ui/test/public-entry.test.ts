import { readdir, readFile } from "node:fs/promises";
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

  it("ships one token stylesheet and no per-component CSS", async () => {
    const styles = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );
    const cssFiles: string[] = [];
    const walk = async (directory: URL) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          await walk(new URL(`${entry.name}/`, directory));
        } else if (entry.name.endsWith(".css")) {
          cssFiles.push(entry.name);
        }
      }
    };
    await walk(new URL("../src/", import.meta.url));

    expect(cssFiles).toEqual(["styles.css"]);
    expect(styles).not.toMatch(/@import "\.\//);
    expect(styles).toContain("@theme inline");
    expect(styles).toContain("--color-signal: var(--py-signal-marker)");
  });
});
