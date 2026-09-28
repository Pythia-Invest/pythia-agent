import type { WorkAgent } from "@/work/types";

export const AGENT_STATUS: Record<WorkAgent["status"], string> = {
  running: "Working",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
  unknown: "Status unknown",
  ended: "Ended",
};
export const AGENT_FILTERS = {
  all: "All agents",
  running: "Working",
  finished: "Finished",
  unknown: "Status unknown",
} as const;
export type AgentFilter = keyof typeof AGENT_FILTERS;
export const AGENT_PAGE_SIZE = 25;

export function agentFinished(agent: WorkAgent) {
  return agent.status !== "running" && agent.status !== "unknown";
}

/** Native text only: do not generate a second title or rewrite the assignment. */
export function agentName(agent: WorkAgent) {
  return (agent.title?.trim() || agent.goal).replace(/\s+/g, " ");
}

/**
 * A one-line handle for an agent: the first sentence of its native task,
 * without the "as of <date>" stamp parents add for grounding. Still native
 * text, shortened rather than rewritten.
 */
export function agentTitle(agent: WorkAgent) {
  const name = agentName(agent).replace(/\s*(?:\.\.\.|…)$/u, "");
  const sentence = /^(.{12,}?[.!?])(?:\s|$)/u.exec(name)?.[1] ?? name;
  return (
    sentence
      .replace(/[.!?]$/u, "")
      .replace(
        /,?\s+as of (?:\d{4}-\d{2}-\d{2}|[a-z]{3,9}\.? \d{1,2},? \d{4})\b/iu,
        "",
      )
      .trim() || name
  );
}

/** Keep enough of the native identity to distinguish otherwise identical tasks. */
export function agentIdentifiers(agents: WorkAgent[]) {
  const ids = agents.map((a) => a.sessionId ?? a.id);
  let length = 6;
  while (new Set(ids.map((id) => id.slice(-length))).size < new Set(ids).size)
    length += 1;
  return new Map(
    agents.map((a) => [a.id, `Agent ${(a.sessionId ?? a.id).slice(-length)}`]),
  );
}

export function matchingAgents(
  agents: WorkAgent[],
  filter: AgentFilter,
  search: string,
) {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return agents.filter((a) => {
    if (
      filter !== "all" &&
      !(filter === "finished" ? agentFinished(a) : a.status === filter)
    )
      return false;
    const text =
      `${a.title ?? ""} ${a.goal} ${a.id} ${a.sessionId ?? ""}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
