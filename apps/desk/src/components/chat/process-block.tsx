"use client";

import { useState } from "react";
import { formatElapsed, useElapsedSeconds } from "./activity-timer";
import { ProcessStepView } from "./process-steps";
import {
  ActivityGlyph,
  DisclosureRow,
  SCAFFOLD_LABEL_CLASS,
  SCAFFOLD_LIVE_LABEL_CLASS,
  SCAFFOLD_META_CLASS,
  SCAFFOLD_RAIL_CLASS,
  ScaffoldBlock,
  TimerText,
} from "./scaffold";
import { humanToolName, toolLabel, toolView } from "./tool-copy";
import { type ProcessStep, toolOutcome, toolParts } from "./turn-model";

/**
 * Counting the steps is what makes the row worth opening: "Show details" alone
 * gives no reason to, and a turn with nothing recorded shows no row at all.
 */
function settledLabel(steps: readonly ProcessStep[], runActive: boolean) {
  const count = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  const tools = toolParts(steps);
  if (tools.some((part) => toolOutcome(part, runActive) === "failed"))
    return `${count} · some work failed`;
  if (tools.some((part) => toolOutcome(part, runActive) === "unconfirmed"))
    return `${count} · some results unavailable`;
  return count;
}

function reasoningLabel(text: string) {
  const plain = text
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/u, "")
    .replace(/[*_`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!plain) return "Thinking…";
  return plain.length > 120 ? `${plain.slice(0, 117).trimEnd()}…` : plain;
}

function liveLabel(steps: readonly ProcessStep[]) {
  const latest = steps.at(-1);
  // Hermes streams no private reasoning, so before the first tool or preview
  // there is nothing to name but the waiting itself.
  if (!latest) return "Thinking…";
  if (latest.kind === "reasoning") return reasoningLabel(latest.part.text);
  if (latest.kind === "tool") {
    const outcome = toolOutcome(latest.part, true);
    if (outcome === "failed")
      return `Could not complete ${humanToolName(toolView(latest.part).toolName)}`;
    return toolLabel(toolView(latest.part), outcome === "running");
  }
  return latest.part.data.description
    ? `Continuing after approval: ${latest.part.data.description}`
    : "Continuing";
}

/** One live status for the whole turn, replaced in place as work advances.
 * Once the run settles, the recorded steps become one quiet disclosure. */
export function ProcessBlock({
  active,
  activityText,
  duration,
  runActive,
  steps,
  since,
}: {
  active: boolean;
  activityText?: string | undefined;
  /** Seconds the whole turn took, once Hermes has reported its terminal event. */
  duration?: number | undefined;
  runActive: boolean;
  steps: readonly ProcessStep[];
  since: number;
}) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsedSeconds(active, since);
  return (
    <ScaffoldBlock
      data-slot="process-block"
      data-state={active ? "live" : "settled"}
    >
      <DisclosureRow
        onToggle={!active && steps.length ? () => setOpen(!open) : undefined}
        open={open}
        trailing={
          active ? (
            <TimerText seconds={elapsed} />
          ) : duration !== undefined ? (
            // What the live timer was counting, kept once it stops.
            <span className={SCAFFOLD_META_CLASS}>
              {formatElapsed(Math.round(duration))}
            </span>
          ) : undefined
        }
      >
        {active ? <ActivityGlyph /> : null}
        <span
          className={active ? SCAFFOLD_LIVE_LABEL_CLASS : SCAFFOLD_LABEL_CLASS}
        >
          {active
            ? activityText
              ? reasoningLabel(activityText)
              : liveLabel(steps)
            : settledLabel(steps, runActive)}
        </span>
      </DisclosureRow>
      {/* A rail rather than an indent: the steps are one ordered record of a
          single turn, and the line is what says where it starts and ends. */}
      {!active && open && steps.length ? (
        <ol className={SCAFFOLD_RAIL_CLASS} data-slot="process-body">
          {steps.map((step) => (
            <ProcessStepView key={step.key} runActive={runActive} step={step} />
          ))}
        </ol>
      ) : null}
    </ScaffoldBlock>
  );
}
