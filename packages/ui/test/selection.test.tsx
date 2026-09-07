import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "../src/selection/checkbox";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../src/selection/combobox";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "../src/selection/command";
import { Radio, RadioGroup } from "../src/selection/radio-group";
import {
  Select,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "../src/selection/select";
import { Switch } from "../src/selection/switch";

describe("selection controls", () => {
  it("keeps interactive wrappers behind explicit client boundaries", async () => {
    const interactiveFiles = [
      "checkbox.tsx",
      "radio-group.tsx",
      "switch.tsx",
      "select.tsx",
      "combobox.tsx",
      "command.tsx",
    ] as const;

    for (const file of interactiveFiles) {
      const source = await readFile(
        new URL(`../src/selection/${file}`, import.meta.url),
        "utf8",
      );
      expect(source.startsWith('"use client";')).toBe(true);
    }

    const barrel = await readFile(
      new URL("../src/selection/index.ts", import.meta.url),
      "utf8",
    );
    expect(barrel.startsWith('"use client";')).toBe(false);
  });

  it("preserves Base UI checkbox, radio, and switch state semantics", () => {
    const markup = renderToStaticMarkup(
      <>
        <Checkbox defaultChecked name="accepted" />
        <Checkbox indeterminate name="partial" />
        <RadioGroup defaultValue="annual" name="cadence">
          <Radio value="quarterly" />
          <Radio value="annual" />
        </RadioGroup>
        <Switch defaultChecked name="alerts" />
      </>,
    );

    expect(markup).toContain('data-checked="" role="checkbox" tabindex="0"');
    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('role="radio"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('name="accepted"');
    expect(markup).toContain('name="cadence"');
    expect(markup).toContain('name="alerts"');
    expect(markup).toContain('data-slot="checkbox-mixed"');
    expect(markup).toContain('data-slot="radio-indicator"');
    expect(markup).toContain('data-slot="switch-thumb"');
  });

  it("keeps Base UI select and combobox composition native", () => {
    const selectMarkup = renderToStaticMarkup(
      <Select defaultValue="quality">
        <SelectTrigger>
          <SelectValue placeholder="Choose a style" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup>
            <SelectList>
              <SelectItem value="quality">Quality</SelectItem>
              <SelectItem value="value">Value</SelectItem>
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </Select>,
    );
    const comboboxMarkup = renderToStaticMarkup(
      <Combobox defaultValue="quality">
        <ComboboxInput aria-label="Style" />
        <ComboboxList>
          <ComboboxItem value="quality">Quality</ComboboxItem>
        </ComboboxList>
      </Combobox>,
    );

    expect(selectMarkup).toContain('role="combobox"');
    expect(selectMarkup).toContain('aria-expanded="false"');
    expect(selectMarkup).toContain('data-slot="select-trigger"');
    expect(selectMarkup).toContain("Quality");
    expect(comboboxMarkup).toContain('role="combobox"');
    expect(comboboxMarkup).toContain('aria-label="Style"');
    expect(comboboxMarkup).toContain('data-slot="combobox-input"');
  });

  it("delegates command filtering and selection markup to cmdk", () => {
    const markup = renderToStaticMarkup(
      <Command label="Find an action">
        <CommandInput placeholder="Search actions" />
        <CommandList label="Actions">
          <CommandItem value="open">Open</CommandItem>
        </CommandList>
      </Command>,
    );

    expect(markup).toContain('cmdk-root=""');
    expect(markup).toContain('cmdk-input=""');
    expect(markup).toContain('cmdk-list=""');
    expect(markup).toContain('cmdk-item=""');
    expect(markup).toContain(">Find an action</label>");
    expect(markup).toContain('aria-labelledby="');
    expect(markup).toContain('data-slot="command-search-icon"');
  });

  it("separates transient highlight from persistent selection", async () => {
    const files = [
      "checkbox",
      "radio-group",
      "switch",
      "select",
      "combobox",
      "command",
      "shared",
    ];
    const sources = await Promise.all(
      files.map((file) =>
        readFile(
          new URL(
            `../src/selection/${file}.${file === "shared" ? "ts" : "tsx"}`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const [
      checkbox = "",
      radio = "",
      switchSource = "",
      select = "",
      combobox = "",
      command = "",
      shared = "",
    ] = sources;
    const all = sources.join("\n");

    // Highlight (keyboard/pointer position) is the quiet hover fill; committed selection is the active fill.
    expect(select).toContain("data-highlighted:bg-interaction-hover");
    expect(select).not.toContain("data-selected:");
    expect(combobox).toContain("data-selected:bg-interaction-active");
    expect(combobox).not.toContain("data-selected:bg-primary");
    expect(command).toContain("data-[selected=true]:bg-interaction-hover");
    // Compact picker geometry shared by Select and Combobox.
    expect(shared).toContain("min(var(--spacing-control),2.25rem)");
    expect(select).toContain("min-w-42");
    expect(select).toContain("min-h-8");
    expect(select).toContain("pr-8 pl-2");
    expect(select).toContain("absolute end-2");
    expect(shared).toContain("text-primary [&>svg]:size-3.5");
    // Focus lives on the group, not the inner input or trigger.
    for (const token of [
      "focus-within:outline-2",
      "focus-within:outline-offset-2",
      "focus-within:outline-ring",
    ]) {
      expect(combobox).toContain(token);
    }
    expect(combobox.match(/focus-visible:outline-none/g)).toHaveLength(2);
    expect(combobox).toContain("empty:hidden");
    for (const token of [
      "focus-within:outline-2",
      "focus-within:-outline-offset-2",
      "focus-within:outline-ring",
    ]) {
      expect(command).toContain(token);
    }
    // Checked controls fill with the primary action color and its foreground.
    for (const token of [
      "data-checked:border-primary",
      "data-checked:bg-primary",
      "data-checked:text-primary-foreground",
    ]) {
      expect(checkbox).toContain(token);
    }
    expect(switchSource).toContain("data-checked:border-primary");
    expect(switchSource).toContain("data-checked:bg-primary");
    expect(radio).toContain("bg-primary-foreground");
    expect(switchSource).toContain("data-checked:bg-primary-foreground");
    expect(all).not.toMatch(/--py-selection-[\w-]+/);
    expect(all).toContain("bg-interaction-hover");
    expect(all).not.toMatch(/\b(?:bg|text|border|from|to|via)-signal\b/);
    expect(all).not.toContain("--py-color-");
  });
});
