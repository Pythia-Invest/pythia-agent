"use client";

import {
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
  Toggle,
  ToggleGroup,
} from "@pythia/ui";
import { CircleOff, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  effortLabels,
  capabilityLabels,
  type Effort,
  type ReasoningCapability,
  useEffortForCapability,
  EffortTrigger,
  EffortLevelItems,
  ComposerSpecimen,
} from "./reasoning-effort-specimen";

function CompleteListSelector({
  capability,
}: {
  capability: ReasoningCapability;
}) {
  const [effort, setEffort] = useEffortForCapability(capability);

  return (
    <ComposerSpecimen capability={capability}>
      <Select
        items={effortLabels}
        onValueChange={(value) => {
          if (typeof value === "string") setEffort(value as Effort);
        }}
        value={effort}
      >
        <EffortTrigger>
          <span className="truncate">Reasoning · {effortLabels[effort]}</span>
        </EffortTrigger>
        <SelectPortal>
          <SelectPositioner align="start" side="top">
            <SelectPopup className="max-h-[min(26rem,var(--available-height))] w-60">
              <SelectList className="max-h-none">
                <SelectGroup>
                  <SelectGroupLabel>Mode</SelectGroupLabel>
                  <SelectItem value="default">
                    <span className="flex items-baseline gap-2">
                      <span>Auto</span>
                      <span className="text-foreground-secondary text-xs">
                        Hermes setting
                      </span>
                    </span>
                  </SelectItem>
                  {capability === "optional" ? (
                    <SelectItem value="none">Off</SelectItem>
                  ) : null}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectGroupLabel>Effort · low to high</SelectGroupLabel>
                  <EffortLevelItems />
                </SelectGroup>
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </ComposerSpecimen>
  );
}

function InlineShortcutSelector({
  capability,
}: {
  capability: ReasoningCapability;
}) {
  const [effort, setEffort] = useEffortForCapability(capability);
  const mode = effort === "default" || effort === "none" ? [effort] : [];

  return (
    <ComposerSpecimen capability={capability}>
      <div className="flex min-w-0 items-center gap-1">
        <ToggleGroup
          className="gap-0.5 rounded-control p-0.5"
          label="Reasoning mode"
          onValueChange={(values) => {
            const next = values[0];
            if (next === "default" || next === "none") setEffort(next);
          }}
          value={mode}
        >
          <Toggle
            appearance="ghost"
            className="h-6 px-2"
            label="Auto"
            size="sm"
            value="default"
          />
          {capability === "optional" ? (
            <Toggle
              appearance="ghost"
              className="h-6 px-2"
              label="Off"
              size="sm"
              value="none"
            />
          ) : null}
        </ToggleGroup>
        <Select
          items={effortLabels}
          onValueChange={(value) => {
            if (typeof value === "string") setEffort(value as Effort);
          }}
          value={effort}
        >
          <EffortTrigger label="Reasoning level">
            <SelectValue>
              {effort === "default" || effort === "none"
                ? "Choose level"
                : effortLabels[effort]}
            </SelectValue>
          </EffortTrigger>
          <SelectPortal>
            <SelectPositioner align="start" side="top">
              <SelectPopup className="max-h-[min(26rem,var(--available-height))] w-48">
                <SelectList className="max-h-none">
                  <SelectGroup>
                    <SelectGroupLabel>Effort · low to high</SelectGroupLabel>
                    <EffortLevelItems />
                  </SelectGroup>
                </SelectList>
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
      </div>
    </ComposerSpecimen>
  );
}

function PopupShortcutSelector({
  capability,
}: {
  capability: ReasoningCapability;
}) {
  const [effort, setEffort] = useEffortForCapability(capability);

  return (
    <ComposerSpecimen capability={capability}>
      <Select
        items={effortLabels}
        onValueChange={(value) => {
          if (typeof value === "string") setEffort(value as Effort);
        }}
        value={effort}
      >
        <EffortTrigger>
          <span className="truncate">Reasoning · {effortLabels[effort]}</span>
        </EffortTrigger>
        <SelectPortal>
          <SelectPositioner align="start" side="top">
            <SelectPopup className="max-h-[min(20rem,var(--available-height))] w-52">
              <SelectList className="max-h-none">
                <SelectGroup className="flex gap-1 px-1 pt-1 pb-0.5">
                  <SelectGroupLabel className="sr-only">
                    Reasoning mode
                  </SelectGroupLabel>
                  <SelectItem
                    className="min-h-6 px-1.5 py-0.5 pr-1.5 font-medium text-foreground-secondary text-xs data-highlighted:bg-transparent data-highlighted:text-foreground data-selected:text-foreground [&_[data-slot=select-item-indicator]]:hidden"
                    value="default"
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles aria-hidden="true" className="size-3" />
                      Auto
                    </span>
                  </SelectItem>
                  {capability === "optional" ? (
                    <SelectItem
                      className="min-h-6 px-1.5 py-0.5 pr-1.5 font-medium text-foreground-secondary text-xs data-highlighted:bg-transparent data-highlighted:text-foreground data-selected:text-foreground [&_[data-slot=select-item-indicator]]:hidden"
                      value="none"
                    >
                      <span className="flex items-center gap-1.5">
                        <CircleOff aria-hidden="true" className="size-3" />
                        Off
                      </span>
                    </SelectItem>
                  ) : (
                    <span className="flex min-h-6 items-center px-1.5 text-foreground-disabled text-xs">
                      Always on
                    </span>
                  )}
                </SelectGroup>
                <SelectGroup>
                  <SelectGroupLabel className="sr-only">
                    Reasoning effort
                  </SelectGroupLabel>
                  <EffortLevelItems withMeter />
                </SelectGroup>
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </ComposerSpecimen>
  );
}

const candidates = [
  {
    description:
      "One compact native dropdown. Auto and Off are grouped above the complete Hermes effort ladder.",
    name: "Complete list",
    render: CompleteListSelector,
  },
  {
    description:
      "Auto and Off stay one click away; the dropdown contains only explicit levels in ascending order.",
    name: "Inline shortcuts",
    render: InlineShortcutSelector,
  },
  {
    description:
      "A quiet trigger keeps the composer clean. Auto and Off become quick choices inside the popup.",
    name: "Popup shortcuts",
    recommended: true,
    render: PopupShortcutSelector,
  },
] as const;

export function ReasoningEffortSelectorsComposition() {
  const [capability, setCapability] = useState<ReasoningCapability>("optional");

  return (
    <section className="grid gap-6" aria-label="Reasoning effort candidates">
      <div className="flex flex-wrap items-center gap-3 rounded-container border border-border bg-raised p-4">
        <div className="grid gap-0.5">
          <span className="font-medium text-sm">Preview model support</span>
          <span className="text-foreground-secondary text-xs">
            Each option follows Hermes’ model capability flags.
          </span>
        </div>
        <Select
          items={capabilityLabels}
          onValueChange={(value) => {
            if (typeof value === "string")
              setCapability(value as ReasoningCapability);
          }}
          value={capability}
        >
          <SelectTrigger
            aria-label="Preview model support"
            className="ms-auto min-w-60"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPortal>
            <SelectPositioner align="end">
              <SelectPopup className="w-64">
                <SelectList>
                  <SelectItem value="optional">
                    {capabilityLabels.optional}
                  </SelectItem>
                  <SelectItem value="required">
                    {capabilityLabels.required}
                  </SelectItem>
                  <SelectItem value="unavailable">
                    {capabilityLabels.unavailable}
                  </SelectItem>
                </SelectList>
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
      </div>

      {candidates.map((candidate, index) => {
        const Candidate = candidate.render;
        return (
          <article
            className="grid gap-4 rounded-container border border-border bg-raised p-5"
            key={candidate.name}
          >
            <header className="grid gap-1">
              <p className="m-0 text-foreground-disabled text-xs uppercase tracking-wide">
                Option {index + 1}
                {"recommended" in candidate && candidate.recommended
                  ? " · Recommended"
                  : ""}
              </p>
              <h3 className="m-0 font-semibold text-foreground text-lg">
                {candidate.name}
              </h3>
              <p className="m-0 text-foreground-secondary text-sm">
                {candidate.description}
              </p>
            </header>
            <Candidate capability={capability} />
          </article>
        );
      })}
    </section>
  );
}
