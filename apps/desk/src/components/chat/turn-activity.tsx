"use client";

import { cn } from "@pythia/ui";
import { ChevronRight } from "lucide-react";
import {
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ApprovalChoice } from "@/server/types";
import type { PlanItem, WorkAgent } from "@/work/types";
import { toolCopy, toolView } from "./tool-copy";
import { record } from "./tool-text";
import type { ProcessStep } from "./turn-model";
import {
  formatDuration,
  liveStatus,
  plainReasoning,
  planItems,
  TurnWork,
} from "./turn-work";
import { AgentRows, PlanList, ToolRow } from "./activity-rows";

const APPROVAL_COPY: Record<ApprovalChoice, string> = {
  always: "You allowed a command permanently",
  deny: "You denied a command",
  once: "You allowed a command once",
  session: "You allowed a command for this chat",
};

function ActivityList({
  steps,
  runActive,
  agents,
  livePlan,
}: {
  steps: readonly ProcessStep[];
  runActive: boolean;
  agents: readonly WorkAgent[];
  livePlan: readonly PlanItem[] | undefined;
}) {
  const rows: ReactNode[] = [];
  let agentsShown = false;
  const lastPlan = steps.findLastIndex(
    (step) => step.kind === "tool" && step.part.toolName === "todo",
  );
  steps.forEach((step, index) => {
    if (step.kind === "commentary" || step.kind === "reasoning") {
      const text = (
        step.kind === "reasoning"
          ? plainReasoning(step.part.text)
          : step.part.text.trim()
      ).replaceAll(/\n\s*\n+/gu, "\n");
      if (text)
        rows.push(
          <li
            key={step.key}
            className="whitespace-pre-wrap break-words py-0.5 text-body text-foreground-secondary leading-ui"
            data-slot="activity-note"
          >
            {text}
          </li>,
        );
      return;
    }
    if (step.kind === "approval") {
      rows.push(
        <li
          key={step.key}
          className="py-0.5 text-body text-foreground-secondary leading-ui"
          data-slot="activity-row"
        >
          {APPROVAL_COPY[step.part.data.responded ?? "deny"]}
        </li>,
      );
      return;
    }
    const part = step.part;
    if (part.toolName === "todo") {
      if (index !== lastPlan) return;
      const items = planItems(part).length ? planItems(part) : (livePlan ?? []);
      if (items.length)
        rows.push(
          <li key={step.key} className="py-1" data-slot="activity-plan">
            <PlanList items={items} />
          </li>,
        );
      return;
    }
    if (part.toolName === "delegate_task") {
      const action = String(record(part.input).action ?? "");
      if (agentsShown || ["list", "status", "steer", "stop"].includes(action))
        return;
      agentsShown = true;
      if (agents.length)
        rows.push(
          <li key={step.key} className="grid gap-0.5 py-0.5">
            <span className="text-body text-foreground-secondary leading-ui">
              {agents.length === 1
                ? "Asked a research agent to help"
                : `Asked ${agents.length} research agents to help`}
            </span>
            <AgentRows agents={agents} limit={agents.length > 5 ? 3 : 5} />
          </li>,
        );
      return;
    }
    if (toolCopy(toolView(part)).hidden) return;
    rows.push(<ToolRow key={step.key} part={part} runActive={runActive} />);
  });
  if (!agentsShown && agents.length)
    rows.push(
      <li key="agents" className="py-0.5">
        <AgentRows agents={agents} />
      </li>,
    );
  if (!rows.length)
    rows.push(
      <li
        key="empty"
        className="py-0.5 text-body text-foreground-secondary leading-ui"
      >
        Nothing to show yet.
      </li>,
    );
  return (
    <ol
      className="m-0 ms-1.5 grid list-none gap-0.5 border-border border-s py-1 ps-3.5"
      data-slot="activity-list"
    >
      {rows}
    </ol>
  );
}

/** Whether a finished turn did anything worth a "Worked for" line. */
export function hasVisibleWork(
  steps: readonly ProcessStep[],
  agents: readonly WorkAgent[],
) {
  return (
    agents.length > 0 ||
    steps.some((step) =>
      step.kind === "tool"
        ? step.part.toolName === "todo" || !toolCopy(toolView(step.part)).hidden
        : step.kind === "approval" || step.part.text.trim().length > 0,
    )
  );
}

/**
 * The quiet line above a reply. While Pythia works it is one sentence that
 * updates in place, with the plan and research agents beneath it; once the
 * answer begins it folds to "Worked for …", and the full record opens inline
 * on request. Live, finished and reloaded turns share this one presentation.
 */
export function TurnActivity({
  steps,
  agents,
  active,
  answering,
  runActive,
  paused,
  since,
  duration,
  onInspect,
  resumed = false,
}: {
  steps: readonly ProcessStep[];
  agents: readonly WorkAgent[];
  /** The run behind this turn is still going. */
  active: boolean;
  /** Answer prose has started. */
  answering: boolean;
  runActive: boolean;
  paused: boolean;
  /** Epoch ms the turn started in this browser, 0 when unknown. */
  since: number;
  duration?: number | undefined;
  onInspect?: (() => void) | undefined;
  /** Tools started again after the answer began. */
  resumed?: boolean;
}) {
  const work = useContext(TurnWork);
  const [open, setOpen] = useState(false);
  // Stay mounted after first use so closing animates instead of vanishing.
  const [opened, setOpened] = useState(false);
  const bodyId = useId();
  // When the answer began, so the line can say how long the work took
  // without waiting for the run to end. Recording it is idempotent.
  const answeredAt = useRef<number | null>(null);
  if (answering && active && since > 0 && answeredAt.current === null)
    answeredAt.current = Date.now();
  const current = liveStatus(steps, agents, paused);
  // Quick steps would make the line blink back to "Thinking" between them:
  // keep the last action on screen briefly before falling back.
  const [status, setStatus] = useState(current);
  useEffect(() => {
    if (current === status) return;
    if (current !== "Thinking") {
      setStatus(current);
      return;
    }
    const timer = window.setTimeout(() => setStatus(current), 1200);
    return () => window.clearTimeout(timer);
  }, [current, status]);

  const agentsBusy = agents.some((agent) => agent.status === "running");
  // After the answer begins, only renewed work brings the live line back.
  // Once the answer has started it stays started: the final text replaces the
  // streamed one at completion, and that swap must not flash "Thinking".
  const answered = useRef(false);
  if (answering) answered.current = true;
  const live = active && (!answered.current || resumed || paused);
  // The first time shown stays: a later, differently measured duration for
  // the same turn must not change the number in front of the reader.
  const shownSeconds = useRef<number | undefined>(undefined);
  shownSeconds.current ??=
    answeredAt.current && since > 0
      ? (answeredAt.current - since) / 1000
      : duration;
  const seconds = shownSeconds.current;
  const settledLabel = agentsBusy
    ? status
    : seconds !== undefined
      ? `Worked for ${formatDuration(seconds)}`
      : "Worked";
  const livePlan = active ? work?.plan : undefined;
  const statusKey = live ? status : "settled";
  // The first status appears without motion (the line may be rebuilt as the
  // reply takes over); every change after that fades in.
  const firstStatus = useRef(statusKey);
  const changed = useRef(false);
  if (statusKey !== firstStatus.current) changed.current = true;
  const showLiveDetail = live && !open;
  const canOpen = hasVisibleWork(steps, agents) || Boolean(livePlan?.length);
  return (
    <div
      className="grid min-w-0 gap-1"
      data-slot="turn-activity"
      data-state={live ? "live" : "settled"}
    >
      <button
        type="button"
        aria-expanded={canOpen ? open : undefined}
        aria-controls={canOpen ? bodyId : undefined}
        disabled={!canOpen}
        onClick={() => {
          onInspect?.();
          setOpened(true);
          setOpen(!open);
        }}
        className="motion-fast group relative flex h-7 min-w-0 max-w-full cursor-pointer items-center gap-1 justify-self-start border-0 bg-transparent p-0 text-start text-body leading-ui disabled:cursor-default"
      >
        {/* The one amber cue in a turn: Pythia is working on it right now.
            It sits in the margin so the text never shifts, and fades out. */}
        <span
          aria-hidden="true"
          className={cn(
            "motion-standard pointer-events-none absolute -start-4 top-1/2 grid size-2 -translate-y-1/2 place-items-center transition-opacity",
            live ? "opacity-100" : "opacity-0",
          )}
          data-slot="turn-working"
        >
          <span className="size-2 rounded-pill bg-signal motion-safe:animate-breathe" />
        </span>
        <span
          aria-live="polite"
          // A changed status fades in over the old one; the first one and a
          // rebuilt line appear without motion, so nothing flickers.
          key={statusKey}
          className={cn(
            "min-w-0 truncate",
            changed.current && "motion-safe:animate-fade",
            !live &&
              "text-foreground-secondary transition-colors group-hover:text-foreground",
          )}
          data-slot="turn-status"
        >
          {live ? (
            <span className="animate-text-shimmer bg-linear-to-r bg-size-[200%_100%] from-45% from-foreground-secondary via-50% via-foreground to-55% to-foreground-secondary bg-clip-text text-transparent motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-foreground-secondary">
              {status}
            </span>
          ) : (
            settledLabel
          )}
        </span>
        {canOpen ? (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "motion-fast size-3.5 shrink-0 text-foreground-disabled transition-[transform,opacity]",
              open && "rotate-90",
              live && !open && "opacity-0 group-hover:opacity-100",
            )}
          />
        ) : null}
      </button>
      {showLiveDetail && (livePlan?.length || agents.length) ? (
        <div
          className="grid gap-2 pb-1 motion-safe:animate-enter"
          data-slot="turn-live-detail"
        >
          {livePlan?.length ? <PlanList items={livePlan} /> : null}
          <AgentRows agents={agents} />
        </div>
      ) : null}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        aria-hidden={!open}
        inert={!open}
        id={bodyId}
      >
        <div className="min-h-0 overflow-hidden">
          {open || opened ? (
            <ActivityList
              steps={steps}
              runActive={runActive}
              agents={agents}
              livePlan={livePlan}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
