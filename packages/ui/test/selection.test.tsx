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
    expect(markup).toContain("pythia-checkbox__mixed");
    expect(markup).toContain("pythia-radio__indicator");
    expect(markup).toContain("pythia-switch__thumb");
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
    expect(selectMarkup).toContain("pythia-select__trigger");
    expect(selectMarkup).toContain("Quality");
    expect(comboboxMarkup).toContain('role="combobox"');
    expect(comboboxMarkup).toContain('aria-label="Style"');
    expect(comboboxMarkup).toContain("pythia-combobox__input");
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
    expect(markup).toContain("pythia-command__search-icon");
  });

  it("separates transient highlight from persistent selection", async () => {
    const css = await readFile(
      new URL("../src/selection/selection.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("var(--py-interaction-active)");
    expect(css).toContain("var(--py-action-primary-background)");
    expect(css).not.toMatch(/\.pythia-select__item\[data-selected\]/);
    expect(css).toMatch(
      /\.pythia-select__item\[data-highlighted\][^}]*background:\s*var\(--py-interaction-hover\)/,
    );
    expect(css).toContain(
      "block-size: min(var(--py-profile-control-height), 2.25rem)",
    );
    expect(css).toMatch(
      /\.pythia-combobox__input-group\s*\{[^}]*block-size:\s*min\(var\(--py-profile-control-height\), 2\.25rem\);[^}]*font-size:\s*var\(--py-font-size-14\);[^}]*min-block-size:\s*min\(var\(--py-profile-control-height\), 2\.25rem\)/,
    );
    expect(css).toMatch(
      /\.pythia-combobox__input-group:focus-within\s*\{[^}]*outline:\s*var\(--py-focus-width\) solid var\(--py-focus-ring\);[^}]*outline-offset:\s*2px/,
    );
    expect(css).toMatch(
      /\.pythia-combobox__input:focus-visible,[^}]*\.pythia-combobox__trigger:focus-visible\s*\{[^}]*outline:\s*none/,
    );
    expect(css).toMatch(
      /\.pythia-combobox__empty:empty\s*\{[^}]*display:\s*none/,
    );
    expect(css).toMatch(
      /\.pythia-command__input-row:focus-within\s*\{[^}]*outline:\s*var\(--py-focus-width\) solid var\(--py-focus-ring\)/,
    );
    expect(css).toContain("min-inline-size: 10.5rem");
    expect(css).toContain("min-block-size: 2rem");
    expect(css).toContain("padding: 0.375rem 2rem 0.375rem var(--py-space-2)");
    expect(css).toMatch(
      /\.pythia-select__item-indicator\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-end:\s*var\(--py-space-2\)/,
    );
    expect(css).toMatch(
      /\.pythia-select__item-indicator,[^}]*\.pythia-combobox__item-indicator\s*\{[^}]*color:\s*var\(--py-action-primary-background\)/,
    );
    expect(css).toMatch(
      /\.pythia-checkbox\[data-checked\],[^}]*background:\s*var\(--py-action-primary-background\);[^}]*border-color:\s*var\(--py-action-primary-background\);[^}]*color:\s*var\(--py-action-primary-foreground\)/,
    );
    expect(css).toMatch(
      /\.pythia-switch\[data-checked\]\s*\{[^}]*background:\s*var\(--py-action-primary-background\);[^}]*border-color:\s*var\(--py-action-primary-background\)/,
    );
    expect(css).toMatch(
      /\.pythia-radio__indicator\s*\{[^}]*background:\s*var\(--py-action-primary-foreground\)/,
    );
    expect(css).toMatch(
      /\.pythia-switch__thumb\[data-checked\]\s*\{[^}]*background:\s*var\(--py-action-primary-foreground\)/,
    );
    const committedComboboxStyle = css.match(
      /\.pythia-combobox__item\[data-selected\]\s*\{[^}]*\}/,
    )?.[0];
    expect(committedComboboxStyle).toContain("--py-interaction-active");
    expect(committedComboboxStyle).not.toContain(
      "--py-action-primary-background",
    );
    expect(css).not.toMatch(/--py-selection-[\w-]+/);
    expect(css).toContain("var(--py-interaction-hover)");
    expect(css).not.toContain("--py-signal-");
    expect(css).not.toContain("--py-color-");
  });
});
