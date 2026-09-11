"use client";
import { SelectTrigger, SelectItem } from "@pythia/ui";
import { type ReactNode, useState, useEffect } from "react";

export const effortLabels = {
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

export type Effort = keyof typeof effortLabels;
export type ReasoningCapability = "optional" | "required" | "unavailable";

const effortScale = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const satisfies readonly Effort[];

export const capabilityLabels: Record<ReasoningCapability, string> = {
  optional: "Reasoning can be switched off",
  required: "Reasoning is always on",
  unavailable: "Reasoning is unavailable",
};

const capabilityModels: Record<ReasoningCapability, string> = {
  optional: "GPT 5.6 Terra",
  required: "GLM 5.3",
  unavailable: "Kimi K3 Instruct",
};

export function useEffortForCapability(capability: ReasoningCapability) {
  const state = useState<Effort>("default");
  const [effort, setEffort] = state;

  useEffect(() => {
    if (
      capability === "unavailable" ||
      (capability === "required" && effort === "none")
    ) {
      setEffort("default");
    }
  }, [capability, effort]);

  return state;
}

export function EffortTrigger({
  children,
  label = "Reasoning effort",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <SelectTrigger
      appearance="inline"
      aria-label={label}
      className="h-7 max-w-44 px-1.5 text-foreground-disabled text-xs hover:text-foreground-secondary"
    >
      {children}
    </SelectTrigger>
  );
}

export function EffortLevelItems({
  withMeter = false,
}: {
  withMeter?: boolean;
}) {
  return effortScale.map((effort, index) => (
    <SelectItem
      className={withMeter ? "min-h-7 py-1 text-xs" : undefined}
      key={effort}
      value={effort}
    >
      <span className="flex min-w-0 items-center gap-2">
        {withMeter ? (
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
        ) : null}
        <span>{effortLabels[effort]}</span>
      </span>
    </SelectItem>
  ));
}

export function ComposerSpecimen({
  capability,
  children,
}: {
  capability: ReasoningCapability;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 rounded-container border border-border bg-canvas p-3">
      <div className="min-h-20 rounded-container border border-border bg-raised px-3 py-2.5 text-foreground-disabled text-sm">
        Ask a research question…
      </div>
      <div className="flex min-h-7 items-center gap-2 px-1">
        <span className="text-foreground-disabled text-xs">
          {capabilityModels[capability]}
        </span>
        {capability === "unavailable" ? null : children}
      </div>
    </div>
  );
}
