import type { DynamicToolUIPart } from "ai";
import { createContext } from "react";
import type { PlanItem, WorkAgent } from "@/work/types";
import { toolCopy, toolView } from "./tool-copy";
import { record } from "./tool-text";
import { type ProcessStep, toolPending } from "./turn-model";

/** What a turn's parts say about its agents, plan and live status. */

/**
 * What a turn can reach beyond its own message: the session's research
 * agents and live plan, and the navigation that opens them. Provided by the
 * chat's work surface; a transcript without it simply shows fewer links.
 */
export const TurnWork = createContext<{
  agents: WorkAgent[];
  plan: PlanItem[] | undefined;
  onSelectAgent: (agent: WorkAgent) => void;
  onShowAllAgents: () => void;
} | null>(null);

export function formatDuration(seconds: number) {
  const whole = Math.max(1, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Only this turn's own delegated agents, by native identity or exact task. */
export function turnAgents(
  steps: readonly ProcessStep[],
  agentParts: readonly WorkAgent[],
  known: readonly WorkAgent[],
) {
  const found = new Map<string, WorkAgent>();
  const latest = (agent: WorkAgent) =>
    known.find((entry) => entry.id === agent.id) ?? agent;
  for (const agent of agentParts) found.set(agent.id, latest(agent));
  for (const step of steps) {
    if (step.kind !== "tool" || step.part.toolName !== "delegate_task")
      continue;
    for (const task of delegatedTasks(step.part)) {
      const agent =
        known.find(
          (entry) =>
            task.id && (entry.id === task.id || entry.sessionId === task.id),
        ) ??
        known.find(
          (entry) => !found.has(entry.id) && sameTask(entry.goal, task.goal),
        );
      // The delegation holds the full task where the listing shortened it.
      if (agent)
        found.set(agent.id, task.goal ? { ...agent, goal: task.goal } : agent);
    }
  }
  return [...found.values()];
}

/** Hermes's agent listing shortens each task to its first 60 characters. */
export function sameTask(listed: string, task: string) {
  if (!listed || !task) return false;
  if (listed === task) return true;
  const shortened = /^(.*?)(?:\.\.\.|…)$/su.exec(listed)?.[1];
  return Boolean(
    shortened && shortened.length >= 20 && task.startsWith(shortened),
  );
}

export function delegatedTasks(part: DynamicToolUIPart) {
  const input = record(part.input);
  const tasks = Array.isArray(input.tasks)
    ? input.tasks
    : typeof input.goal === "string"
      ? [{ goal: input.goal }]
      : [];
  return tasks.map((task) => {
    const entry = record(task);
    return {
      id: typeof entry.id === "string" ? entry.id : "",
      goal: typeof entry.goal === "string" ? entry.goal : "",
    };
  });
}

export function planItems(part: DynamicToolUIPart): PlanItem[] {
  const todos = record(part.input).todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((todo, index) => {
    const entry = record(todo);
    const content = typeof entry.content === "string" ? entry.content : "";
    if (!content) return [];
    const status = [
      "pending",
      "in_progress",
      "completed",
      "cancelled",
    ].includes(String(entry.status))
      ? (entry.status as PlanItem["status"])
      : "pending";
    return [{ id: String(entry.id ?? index), content, status }];
  });
}

/** The one sentence the live status line shows. */
export function liveStatus(
  steps: readonly ProcessStep[],
  agents: readonly WorkAgent[],
  paused: boolean,
) {
  if (paused) return "Waiting for your approval";
  const pending = steps.findLast(
    (step) => step.kind === "tool" && toolPending(step.part),
  );
  if (pending?.kind === "tool") {
    const copy = toolCopy(toolView(pending.part));
    if (copy.status !== "Thinking") return copy.status;
  }
  const working = agents.filter((agent) => agent.status === "running").length;
  if (working)
    return working === 1
      ? "A research agent is working"
      : `${working} research agents are working`;
  return "Thinking";
}

/** Reasoning summaries arrive as "**Title**\n\nText"; show them as plain prose. */
export function plainReasoning(text: string) {
  return text.replaceAll(/\*\*(.+?)\*\*/gu, "$1").trim();
}
