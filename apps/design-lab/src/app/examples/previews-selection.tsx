"use client";

import {
  Checkbox,
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Radio,
  RadioGroup,
  SearchSelect,
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@pythia/ui";
import { useState } from "react";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

const choices = ["Quality", "Value", "Momentum", "Income"] as const;

export function SelectionPreview({ route }: { route: CatalogRoute }) {
  const [command, setCommand] = useState("No synthetic command selected.");

  switch (route) {
    case "/components/checkbox":
      return (
        <SpecimenGrid>
          <Specimen label="Checked, mixed, and disabled">
            <div className="catalog-choice-list">
              <div className="catalog-choice-row">
                <Checkbox aria-labelledby="checkbox-sources" defaultChecked />
                <span id="checkbox-sources">Include synthetic sources</span>
              </div>
              <div className="catalog-choice-row">
                <Checkbox aria-labelledby="checkbox-coverage" indeterminate />
                <span id="checkbox-coverage">Partial synthetic coverage</span>
              </div>
              <div className="catalog-choice-row">
                <Checkbox aria-labelledby="checkbox-note" />
                <span id="checkbox-note">Add analyst note</span>
              </div>
              <div className="catalog-choice-row" data-disabled="">
                <Checkbox aria-labelledby="checkbox-unavailable" disabled />
                <span data-disabled-label="" id="checkbox-unavailable">
                  Unavailable option
                </span>
              </div>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/radio-group":
      return (
        <SpecimenGrid>
          <Specimen label="Mutually exclusive choice">
            <RadioGroup
              aria-label="Synthetic reporting cadence"
              defaultValue="quarterly"
              name="synthetic-cadence"
            >
              <div className="catalog-choice-row">
                <Radio aria-labelledby="radio-monthly" value="monthly" />
                <span id="radio-monthly">Monthly</span>
              </div>
              <div className="catalog-choice-row">
                <Radio aria-labelledby="radio-quarterly" value="quarterly" />
                <span id="radio-quarterly">Quarterly</span>
              </div>
              <div className="catalog-choice-row">
                <Radio aria-labelledby="radio-annual" value="annual" />
                <span id="radio-annual">Annual</span>
              </div>
              <div className="catalog-choice-row" data-disabled="">
                <Radio aria-labelledby="radio-live" disabled value="live" />
                <span data-disabled-label="" id="radio-live">
                  Live (unavailable)
                </span>
              </div>
            </RadioGroup>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/switch":
      return (
        <SpecimenGrid>
          <Specimen label="Immediate settings">
            <div className="catalog-choice-list">
              <div className="catalog-choice-row">
                <Switch aria-labelledby="switch-annotations" defaultChecked />
                <span id="switch-annotations">Show synthetic annotations</span>
              </div>
              <div className="catalog-choice-row">
                <Switch aria-labelledby="switch-condense" />
                <span id="switch-condense">Condense synthetic rows</span>
              </div>
              <div className="catalog-choice-row" data-disabled="">
                <Switch aria-labelledby="switch-alerts" disabled />
                <span data-disabled-label="" id="switch-alerts">
                  External alerts unavailable
                </span>
              </div>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/select":
      return (
        <SpecimenGrid>
          <Specimen label="Native listbox selection">
            <div className="catalog-select-demo">
              <Select
                defaultValue="quality"
                items={{
                  custom: "Custom unavailable",
                  quality: "Quality",
                  value: "Value",
                }}
              >
                <SelectTrigger aria-label="Synthetic investing style">
                  <SelectValue placeholder="Choose a synthetic style" />
                </SelectTrigger>
                <SelectPortal>
                  <SelectPositioner>
                    <SelectPopup>
                      <SelectList>
                        <SelectGroup>
                          <SelectGroupLabel>Styles</SelectGroupLabel>
                          <SelectItem value="quality">Quality</SelectItem>
                          <SelectItem value="value">Value</SelectItem>
                        </SelectGroup>
                        <SelectSeparator />
                        <SelectItem disabled value="custom">
                          Custom unavailable
                        </SelectItem>
                      </SelectList>
                    </SelectPopup>
                  </SelectPositioner>
                </SelectPortal>
              </Select>
            </div>
          </Specimen>
          <Specimen label="Inline toolbar selection">
            <Select
              defaultValue="quality"
              items={{ quality: "Quality", value: "Value" }}
            >
              <SelectTrigger
                appearance="inline"
                aria-label="Synthetic investing style"
              >
                <span className="shrink-0 font-medium text-foreground-secondary text-xs">
                  Style
                </span>
                <SelectValue />
              </SelectTrigger>
              <SelectPortal>
                <SelectPositioner align="start" side="top">
                  <SelectPopup className="w-48">
                    <SelectList>
                      <SelectItem value="quality">Quality</SelectItem>
                      <SelectItem value="value">Value</SelectItem>
                    </SelectList>
                  </SelectPopup>
                </SelectPositioner>
              </SelectPortal>
            </Select>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/combobox":
      return (
        <SpecimenGrid>
          <Specimen label="Searchable native selection">
            <div className="catalog-select-demo">
              <Combobox defaultValue="Quality" items={choices}>
                <ComboboxInputGroup>
                  <ComboboxInput
                    aria-label="Synthetic style"
                    placeholder="Filter synthetic styles…"
                  />
                  <ComboboxTrigger />
                </ComboboxInputGroup>
                <ComboboxPortal>
                  <ComboboxPositioner>
                    <ComboboxPopup>
                      <ComboboxEmpty>
                        No matching synthetic style.
                      </ComboboxEmpty>
                      <ComboboxList>
                        {(choice: (typeof choices)[number]) => (
                          <ComboboxItem key={choice} value={choice}>
                            {choice}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxPopup>
                  </ComboboxPositioner>
                </ComboboxPortal>
              </Combobox>
            </div>
          </Specimen>
          <Specimen label="Compact searchable select">
            <div className="catalog-select-demo">
              <SearchSelect.Root defaultValue="Quality" items={choices}>
                <SearchSelect.Trigger
                  appearance="inline"
                  aria-label="Synthetic style"
                >
                  <SearchSelect.Value placeholder="Select style" />
                </SearchSelect.Trigger>
                <SearchSelect.Portal>
                  <SearchSelect.Positioner>
                    <SearchSelect.Popup aria-label="Select synthetic style">
                      <SearchSelect.Input
                        aria-label="Search synthetic styles"
                        placeholder="Search styles…"
                      />
                      <SearchSelect.Empty>
                        No matching style.
                      </SearchSelect.Empty>
                      <SearchSelect.List>
                        {(choice: (typeof choices)[number]) => (
                          <SearchSelect.Item key={choice} value={choice}>
                            {choice}
                          </SearchSelect.Item>
                        )}
                      </SearchSelect.List>
                    </SearchSelect.Popup>
                  </SearchSelect.Positioner>
                </SearchSelect.Portal>
              </SearchSelect.Root>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/command":
      return (
        <SpecimenGrid>
          <Specimen label="Filtered command choices">
            <Command label="Synthetic actions">
              <CommandInput placeholder="Search synthetic actions…" />
              <CommandList label="Synthetic actions">
                <CommandEmpty>No matching synthetic action.</CommandEmpty>
                <CommandGroup heading="Navigate">
                  <CommandItem
                    onSelect={() => setCommand("Opened synthetic summary.")}
                    value="Open summary"
                  >
                    Open summary
                  </CommandItem>
                  <CommandItem
                    onSelect={() => setCommand("Opened synthetic evidence.")}
                    value="Open evidence"
                  >
                    Open evidence
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="Manage">
                  <CommandItem disabled value="Export unavailable">
                    Export unavailable
                  </CommandItem>
                  <CommandItem
                    onSelect={() => setCommand("Synthetic note added.")}
                    value="Add note"
                  >
                    Add note
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
            <DemoNote>{command}</DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated selection preview: ${route}`);
  }
}
