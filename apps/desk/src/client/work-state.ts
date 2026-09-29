import type { DeskUIMessage } from "./chat-message";
import type { PlanItem, WorkAgent, WorkPage } from "@/work/types";

/** A moving recent-history window is not a clear/delete event. Keep bounded
 * native observations in the query cache; an explicit empty snapshot wins. */
export function mergeObservedWork(
  previous: WorkPage | undefined,
  next: WorkPage,
): WorkPage {
  if (!previous) return next;
  return {
    ...next,
    plans: [
      ...new Map(
        [...previous.plans, ...next.plans].map((plan) => [plan.id, plan]),
      ).values(),
    ].slice(-32),
    agents: [
      ...new Map(
        [...previous.agents, ...next.agents].map((agent) => [agent.id, agent]),
      ).values(),
    ].slice(-200),
    assignments: [
      ...new Map(
        [...previous.assignments, ...next.assignments].map((assignment) => [
          JSON.stringify(assignment),
          assignment,
        ]),
      ).values(),
    ].slice(-200),
  };
}

export function workRevision(messages: DeskUIMessage[], busy: boolean) {
  const tail = messages.at(-1);
  const changes = tail?.parts.flatMap((p) =>
    p.type === "data-agent"
      ? [`${p.data.id}:${p.data.status}`]
      : p.type === "dynamic-tool" &&
          ["todo", "delegate_task"].includes(p.toolName) &&
          p.state.startsWith("output")
        ? [`${p.toolCallId}:${p.state}`]
        : [],
  );
  return `${tail?.id}:${busy}:${changes?.join("|") ?? ""}`;
}

export function workState(
  pages: WorkPage[],
  messages: DeskUIMessage[],
  busy: boolean,
) {
  const ordered = [...pages].reverse();
  const plans = [
    ...new Map(ordered.flatMap((p) => p.plans).map((p) => [p.id, p])).values(),
  ];
  const plan = plans.at(-1);
  const removed = new Map<string, PlanItem>();
  for (let i = 1; i < plans.length; i += 1) {
    const next = plans[i];
    const previous = plans[i - 1];
    if (!next || !previous) continue;
    for (const item of previous.items)
      if (!next.items.some((n) => n.id === item.id)) removed.set(item.id, item);
    for (const item of next.items) removed.delete(item.id);
  }
  const agents = new Map<string, WorkAgent>();
  for (const agent of ordered.flatMap((p) => p.agents))
    agents.set(agent.id, agent);
  for (const message of messages)
    for (const part of message.parts) {
      if (part.type !== "data-agent") continue;
      const live = part.data;
      const saved = agents.get(live.id);
      const streaming = busy && message === messages.at(-1);
      agents.set(live.id, {
        ...saved,
        ...live,
        // An explicit outcome from the stream wins. A "started" event only
        // lasts while its stream does: after that the saved session speaks
        // (background children rarely report back on the parent's stream),
        // and without one a parent ending proves nothing about the child.
        status:
          live.status !== "running"
            ? live.status
            : saved?.status === "ended"
              ? "ended"
              : streaming
                ? "running"
                : (saved?.status ?? "unknown"),
      });
    }
  return {
    plan,
    removed: [...removed.values()],
    agents: [...agents.values()],
    assignments: ordered.flatMap((p) => p.assignments),
  };
}

/** Native order and parentage, with malformed cycles/dangling parents kept visible. */
export function planRows(items: PlanItem[]) {
  const seen = new Set<string>();
  const rows: { item: PlanItem; depth: number }[] = [];
  const visit = (item: PlanItem, depth: number) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    rows.push({ item, depth: Math.min(depth, 3) });
    for (const child of items)
      if (child.parent === item.id) visit(child, depth + 1);
  };
  for (const item of items)
    if (!item.parent || !items.some((parent) => parent.id === item.parent))
      visit(item, 0);
  for (const item of items) visit(item, 0);
  return rows;
}
