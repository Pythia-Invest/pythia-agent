/** Read-only projections of native work. These records never drive execution. */
export type PlanItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  parent?: string;
};
export type PlanSnapshot = { id: string; revision: number; items: PlanItem[] };
export type WorkAgent = {
  id: string;
  sessionId?: string;
  parentId?: string;
  goal: string;
  title?: string;
  model?: string;
  status: "running" | "completed" | "stopped" | "failed" | "unknown" | "ended";
  summary?: string;
  /** When Hermes started the child's session, in epoch seconds. */
  startedAt?: number;
  /** The child's latest native activity, in epoch seconds. */
  lastActive?: number;
  /** When Hermes ended the child's session, in epoch seconds. */
  endedAt?: number;
};
export type WorkAssignment = { goal: string; context?: string };
export type WorkPage = {
  plans: PlanSnapshot[];
  agents: WorkAgent[];
  assignments: WorkAssignment[];
  offset: number;
  historyMore: boolean;
  agentsMore: boolean;
};
export type AgentPage = {
  assignment: string;
  assignmentId?: string;
  ended: boolean;
  messages: import("@/client/chat-message").DeskUIMessage[];
  offset: number;
  more: boolean;
};
