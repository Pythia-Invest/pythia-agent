"use client";

import { Streamdown } from "streamdown";
import type { ApprovalChoice } from "@/server/types";
import { formatElapsed } from "./activity-timer";
import { LINK_SAFETY } from "./message-parts";
import { SCAFFOLD_META_CLASS, StepGlyph } from "./scaffold";
import { humanToolName, toolLabel, toolView } from "./tool-copy";
import type { DynamicToolUIPart } from "ai";
import type { ReactNode } from "react";
import { type ProcessStep, toolOutcome, type ToolOutcome } from "./turn-model";
import { record } from "./tool-copy";

const APPROVAL_COPY: Record<ApprovalChoice, string> = {
  always: "Allowed permanently",
  deny: "Denied",
  once: "Allowed once",
  session: "Allowed for this chat",
};

/**
 * How long a tool took, as Hermes reported it.
 *
 * The mapper attaches it to the chunk as provider metadata; the AI SDK files
 * that under `resultProviderMetadata` once a tool has output and under
 * `callProviderMetadata` before then, so both are read. Nothing in the browser
 * knows this number, which is why it is read back rather than timed here.
 */
function stepSeconds(part: DynamicToolUIPart): number | undefined {
  const metadata =
    ("resultProviderMetadata" in part
      ? part.resultProviderMetadata
      : undefined) ?? part.callProviderMetadata;
  const seconds = metadata?.pythia?.durationSeconds;
  return typeof seconds === "number" ? seconds : undefined;
}

/** One line on the rail: where the step got to, what it was, how long it took. */
function StepRow({
  children,
  detail,
  duration,
  slot,
  state,
}: {
  children: ReactNode;
  detail?: string | undefined;
  duration?: number | undefined;
  slot: string;
  state: ToolOutcome;
}) {
  return (
    <li
      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 py-0.5"
      data-slot={slot}
      data-state={state}
    >
      <StepGlyph state={state} />
      <div className="min-w-0 text-foreground-secondary text-xs leading-ui">
        {children}
      </div>
      {duration === undefined ? (
        <span />
      ) : (
        <span className={SCAFFOLD_META_CLASS}>
          {formatElapsed(Math.round(duration))}
        </span>
      )}
      {detail ? (
        <code className="col-span-2 col-start-2 mt-1 max-h-30 overflow-auto whitespace-pre-wrap break-words rounded-md bg-canvas px-2 py-1.5 font-sans text-foreground-secondary text-xs leading-reading">
          {detail}
        </code>
      ) : null}
    </li>
  );
}

export function ProcessStepView({
  runActive,
  step,
}: {
  runActive: boolean;
  step: ProcessStep;
}) {
  if (step.kind === "reasoning") {
    return (
      <StepRow slot="process-reasoning" state="completed">
        <div className="leading-reading [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_p]:my-1">
          <Streamdown linkSafety={LINK_SAFETY} mode="static">
            {step.part.text}
          </Streamdown>
        </div>
      </StepRow>
    );
  }
  if (step.kind === "approval") {
    const denied = step.part.data.responded === "deny";
    return (
      <StepRow
        detail={step.part.data.command}
        slot="process-approval"
        state={denied ? "failed" : "completed"}
      >
        {APPROVAL_COPY[step.part.data.responded ?? "deny"]}
        {step.part.data.description ? `: ${step.part.data.description}` : ""}
      </StepRow>
    );
  }
  const part = step.part;
  const view = toolView(part);
  const outcome = toolOutcome(part, runActive);
  const output =
    part.state === "output-error"
      ? part.errorText
      : part.state === "output-available" && typeof part.output === "string"
        ? part.output.trim()
        : "";
  const label =
    outcome === "failed"
      ? `Could not complete ${humanToolName(view.toolName)}`
      : outcome === "unconfirmed"
        ? `Started ${humanToolName(view.toolName)} · result unavailable`
        : toolLabel(view, outcome === "running");
  if (view.kind === "delegate") {
    const tasks = Array.isArray(view.input.tasks)
      ? view.input.tasks.map(record)
      : [];
    return (
      <StepRow slot="process-tool" state={outcome}>
        {label}
        {tasks.length ? (
          <ul
            className="m-0 mt-1 grid list-none gap-1 p-0"
            aria-label="Delegated research tasks"
          >
            {tasks.map((task, index) => {
              const goal =
                typeof task.goal === "string"
                  ? task.goal
                  : `Research task ${index + 1}`;
              const status =
                typeof task.status === "string" ? task.status : "running";
              const duration =
                typeof task.durationSeconds === "number"
                  ? `${Math.round(task.durationSeconds)}s`
                  : "";
              return (
                <li
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
                  key={String(task.id ?? index)}
                >
                  <span className="min-w-0 truncate text-foreground-secondary">
                    {goal}
                  </span>
                  <span className="numeric text-foreground-disabled">
                    {status === "running" ? "Working" : status}
                    {duration ? ` · ${duration}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </StepRow>
    );
  }
  return (
    <StepRow
      detail={outcome === "failed" && output ? output : undefined}
      duration={stepSeconds(part)}
      slot="process-tool"
      state={outcome}
    >
      <span className={outcome === "failed" ? "text-error" : undefined}>
        {label}
      </span>
    </StepRow>
  );
}
