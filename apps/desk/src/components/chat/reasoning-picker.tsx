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
  SelectTrigger,
  SelectValue,
} from "@pythia/ui";
import { CircleOff, Sparkles } from "lucide-react";
import type { ModelSelection } from "@/server/model-catalog";

const effortLabels = {
  default: "Auto",
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
  ultra: "Ultra",
} as const;

const effortScale = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const satisfies readonly ModelSelection["effort"][];

function EffortLevelOptions() {
  return effortScale.map((effort, index) => (
    <SelectItem className="min-h-7 py-1 text-xs" key={effort} value={effort}>
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="flex w-6 items-end gap-px">
          {Array.from({ length: 4 }, (_, bar) => (
            <span
              className={`w-1 rounded-full ${
                bar <= Math.floor((index * 3) / (effortScale.length - 1))
                  ? "bg-foreground-secondary"
                  : "bg-border"
              }`}
              key={bar}
              style={{ height: `${5 + bar * 2}px` }}
            />
          ))}
        </span>
        <span>{effortLabels[effort]}</span>
      </span>
    </SelectItem>
  ));
}

export function ReasoningPicker({
  disabled,
  selection,
  onChange,
  canDisableReasoning,
}: {
  disabled?: boolean | undefined;
  selection: ModelSelection;
  onChange: (selection: ModelSelection) => void;
  canDisableReasoning: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      items={effortLabels}
      onValueChange={(value) => {
        if (typeof value !== "string") return;
        onChange({
          ...selection,
          ...(value === "default"
            ? { effort: undefined }
            : { effort: value as ModelSelection["effort"] }),
        });
      }}
      value={selection.effort ?? "default"}
    >
      <SelectTrigger
        appearance="inline"
        aria-label="Reasoning effort"
        className="h-7 max-w-44 shrink-0 px-1.5 text-foreground-disabled text-xs hover:text-foreground-secondary"
      >
        <SelectValue className="min-w-0 truncate">
          Reasoning · {effortLabels[selection.effort ?? "default"]}
        </SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner align="start" side="top">
          <SelectPopup className="max-h-[min(20rem,var(--available-height))] w-52">
            <SelectList className="max-h-[min(15.25rem,calc(var(--available-height)-0.5rem))]">
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
                {canDisableReasoning ? (
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
                <EffortLevelOptions />
              </SelectGroup>
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}
