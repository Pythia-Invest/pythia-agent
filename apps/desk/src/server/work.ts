import {
  historyToMessages,
  messageText,
  parseToolCalls,
} from "@/client/chat-message";
import type {
  PlanItem,
  PlanSnapshot,
  WorkAgent,
  WorkAssignment,
  WorkPage,
} from "@/work/types";
import type { HermesClient, HermesMessage } from "./types";
import { HermesApiError, object } from "./hermes-records";

export const WORK_PAGE_SIZE = 200;

function json(value: unknown) {
  if (typeof value !== "string") return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

/** Full successful snapshots only. A failed write must not clear the plan. */
export function projectWork(rows: HermesMessage[]) {
  const plans: PlanSnapshot[] = [];
  const assignments: WorkAssignment[] = [];
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.display_kind === "hidden") continue;
    for (const call of parseToolCalls(row.tool_calls, row.id)) {
      names.set(call.id, call.name);
      if (call.name !== "delegate_task") continue;
      const input = object(call.input);
      if (input.action && input.action !== "spawn") continue;
      for (const task of Array.isArray(input.tasks) ? input.tasks : [input]) {
        const entry = object(task);
        if (typeof entry.goal === "string")
          assignments.push({
            goal: entry.goal,
            ...(typeof entry.context === "string"
              ? { context: entry.context }
              : {}),
          });
      }
    }
    if (
      row.role !== "tool" ||
      (row.tool_name ?? names.get(row.tool_call_id ?? "")) !== "todo"
    )
      continue;
    const value = json(row.content);
    if (!Array.isArray(value.todos) || value.error || value.todos.length > 256)
      continue;
    const items: PlanItem[] = [];
    for (const entry of value.todos) {
      const item = object(entry);
      if (
        typeof item.id !== "string" ||
        typeof item.content !== "string" ||
        !["pending", "in_progress", "completed", "cancelled"].includes(
          String(item.status),
        )
      )
        break;
      items.push({
        id: item.id,
        content: item.content,
        status: item.status as PlanItem["status"],
        ...(typeof item.parent === "string" ? { parent: item.parent } : {}),
      });
    }
    if (items.length === value.todos.length)
      plans.push({
        id: row.id,
        revision: typeof value.revision === "number" ? value.revision : 0,
        items,
      });
  }
  return { plans, assignments };
}

export async function readWork(
  client: HermesClient,
  sessionId: string,
  offset: number,
  signal: AbortSignal,
): Promise<WorkPage> {
  const [history, sessions] = await Promise.all([
    client.listMessages(sessionId, WORK_PAGE_SIZE, offset, { signal }),
    client.listSessions(WORK_PAGE_SIZE, offset, {
      includeChildren: true,
      source: "subagent",
      signal,
    }),
  ]);
  return {
    ...projectWork(history.data),
    offset,
    historyMore: history.returned === WORK_PAGE_SIZE,
    agentsMore: sessions.length >= WORK_PAGE_SIZE,
    agents: sessions
      .filter(
        (s) => s.source === "subagent" && s.parent_session_id === sessionId,
      )
      .map((s) => ({
        id: s.id,
        sessionId: s.id,
        goal: s.preview || "Research agent",
        ...(s.title ? { title: s.title } : {}),
        status: agentStatus(s),
        ...(s.started_at ? { startedAt: s.started_at } : {}),
        ...(s.last_active ? { lastActive: s.last_active } : {}),
        ...(s.ended_at ? { endedAt: s.ended_at } : {}),
        ...(s.model ? { model: s.model } : {}),
      })),
  };
}

/**
 * A child session Hermes has not ended is working while it shows activity.
 * `last_active` includes Hermes's mid-turn heartbeat
 * (hermes_state_common.py:_sql_session_last_active), and Hermes itself treats
 * a child as stalled after at most 1200s without progress
 * (tools/delegate_tool.py:_HEARTBEAT_STALE_CYCLES_IN_TOOL). Past that, Desk
 * cannot tell working from abandoned and says so.
 */
export const AGENT_STALE_SECONDS = 1200;
export function agentStatus(
  session: { ended_at?: number | null; last_active?: number | null },
  now = Date.now() / 1000,
): WorkAgent["status"] {
  if (session.ended_at) return "ended";
  return session.last_active && now - session.last_active <= AGENT_STALE_SECONDS
    ? "running"
    : "unknown";
}

export async function readAgent(
  client: HermesClient,
  parentId: string,
  childId: string,
  offset: number,
  signal: AbortSignal,
) {
  const child = await client.getSession(childId, signal);
  // Parent links also represent branches/compaction. Only native subagent sessions qualify.
  if (child.source !== "subagent" || child.parent_session_id !== parentId)
    throw new HermesApiError(
      "This agent does not belong to this conversation.",
      404,
    );
  const [first, latest] = await Promise.all([
    client.listMessages(childId, 20, 0, { order: "oldest", signal }),
    client.listMessages(childId, 100, offset, { signal }),
  ]);
  const assignment = first.data.find(
    (row) => row.role === "user" && row.display_kind !== "hidden",
  );
  return {
    assignment: messageText(assignment?.content ?? ""),
    ...(assignment ? { assignmentId: assignment.id } : {}),
    ended: Boolean(child.ended_at),
    messages: historyToMessages(latest.data),
    offset,
    more: latest.returned === 100,
  };
}
