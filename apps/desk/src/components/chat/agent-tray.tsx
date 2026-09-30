"use client";

import { cn } from "@pythia/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { WorkAgent } from "@/work/types";
import { AgentMark } from "./activity-rows";
import { agentTitle } from "./agent-presentation";
import { CHAT_MEASURE_CLASS } from "./chat-opening";

/** How long the tray keeps a finished agent, and one that went quiet. */
export const FINISHED_SECONDS = 30 * 60;
export const QUIET_SECONDS = 2 * 60 * 60;

/** Native timestamps only: seconds while working, minutes after. */
export function duration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60)
    return `${minutes}m ${String(whole % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The chat's agents still worth a glance: working, quiet or just finished. */
export function trayAgents(agents: readonly WorkAgent[], now: number) {
  const working = agents
    .filter((agent) => agent.status === "running")
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const quiet = agents.filter(
    (agent) =>
      agent.status === "unknown" &&
      agent.lastActive !== undefined &&
      now - agent.lastActive <= QUIET_SECONDS,
  );
  const finished = agents
    .filter(
      (agent) =>
        agent.status !== "running" &&
        agent.status !== "unknown" &&
        agent.endedAt !== undefined &&
        now - agent.endedAt <= FINISHED_SECONDS,
    )
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return { working, quiet, finished };
}

function summary({ working, quiet, finished }: ReturnType<typeof trayAgents>) {
  const parts = [
    working.length ? `${working.length} running` : "",
    quiet.length ? `${quiet.length} not reporting` : "",
    finished.length ? `${finished.length} finished` : "",
  ].filter(Boolean);
  const total = working.length + quiet.length + finished.length;
  return `${total === 1 ? "Research agent" : "Research agents"}: ${parts.join(" · ")}`;
}

/**
 * The chat's background research agents, on the composer's top edge, as
 * Claude shows background tasks: a one-line count while anything works or
 * recently finished, opening upward into the list. Choosing an agent opens its
 * conversation. Read-only: the pinned Hermes cannot stop one delegated agent
 * from outside its parent's turn, and records no outcome beyond ending
 * (ADR 0047).
 */
export function AgentTray({
  agents,
  onSelect,
}: {
  agents: readonly WorkAgent[];
  onSelect: (agent: WorkAgent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const listId = useId();
  const groups = trayAgents(agents, now);
  const shown = [...groups.working, ...groups.quiet, ...groups.finished];
  const working = groups.working.length > 0;
  useEffect(() => {
    // Seconds matter only while an open list shows a working agent's time.
    const interval = open && working ? 1_000 : 30_000;
    const timer = window.setInterval(() => setNow(Date.now() / 1000), interval);
    return () => window.clearInterval(timer);
  }, [open, working]);
  if (!shown.length) return null;
  const Chevron = open ? ChevronDown : ChevronUp;
  return (
    <div className={CHAT_MEASURE_CLASS} data-slot="agent-tray">
      {/* Inset on the composer's own measure, so it reads as part of it. */}
      <div className="mx-3 flex flex-col overflow-hidden rounded-t-container border border-border border-b-0 bg-canvas">
        {open ? (
          <ul
            id={listId}
            aria-label="Research agents in this chat"
            className="m-0 grid max-h-[min(16rem,40vh)] list-none overflow-y-auto border-border border-b p-1"
          >
            {shown.map((agent) => (
              <li key={agent.id} className="min-w-0">
                <button
                  type="button"
                  className="motion-fast flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2 text-start text-body text-foreground transition-colors hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                  onClick={() => onSelect(agent)}
                >
                  <AgentMark status={agent.status} />
                  <span className="min-w-0 flex-1 truncate">
                    {agentTitle(agent)}
                  </span>
                  <span className="numeric flex-none text-foreground-secondary text-xs">
                    {detail(agent, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "motion-fast flex h-8 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 text-start text-foreground-secondary text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
          )}
        >
          {/* The count says it; the mark only shows motion. */}
          <span aria-hidden="true" className="flex">
            <AgentMark status={working ? "running" : "ended"} />
          </span>
          <span className="min-w-0 flex-1 truncate">{summary(groups)}</span>
          <Chevron aria-hidden="true" className="size-3.5 flex-none" />
        </button>
      </div>
    </div>
  );
}

function detail(agent: WorkAgent, now: number) {
  if (agent.status === "running")
    return agent.startedAt ? duration(now - agent.startedAt) : "working";
  if (agent.status === "unknown")
    return agent.lastActive
      ? `quiet ${duration(now - agent.lastActive).replace(/ \d+s$/u, "")}`
      : "status unknown";
  return agent.endedAt
    ? `ended ${duration(now - agent.endedAt).replace(/ \d+s$/u, "")} ago`
    : "ended";
}
