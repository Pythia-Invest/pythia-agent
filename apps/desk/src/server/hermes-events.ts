import type { ApprovalChoice, DeskRunEvent, RunUsage } from "./types";

const QUALIFIED_EVENTS = new Set([
  "message.delta",
  "tool.started",
  "tool.completed",
  "reasoning.available",
  "subagent.start",
  "subagent.complete",
  "approval.request",
  "approval.responded",
  "run.steered",
  "run.completed",
  "run.failed",
  "run.cancelled",
]);
const APPROVAL_CHOICES = new Set<ApprovalChoice>([
  "once",
  "session",
  "always",
  "deny",
]);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function usage(value: unknown): RunUsage | undefined {
  const source = object(value);
  const result: RunUsage = {};
  const input = number(source.input_tokens);
  const output = number(source.output_tokens);
  const total = number(source.total_tokens);
  if (input !== undefined) result.input_tokens = input;
  if (output !== undefined) result.output_tokens = output;
  if (total !== undefined) result.total_tokens = total;
  return Object.keys(result).length ? result : undefined;
}

export function mapHermesEvent(value: unknown): DeskRunEvent | null {
  const source = object(value);
  const event = string(source.event);
  if (!event || !QUALIFIED_EVENTS.has(event)) return null;
  const mapped: DeskRunEvent = { event };
  const directStrings = [
    "run_id",
    "delta",
    "text",
    "tool",
    "description",
    "command",
    "request_id",
    "output",
    "status",
    "summary",
    "goal",
    "child_session_id",
    "subagent_id",
    "model",
    "pending_steer",
    "code",
  ] as const;
  for (const field of directStrings) {
    const value = string(source[field]);
    if (value !== undefined) mapped[field] = value;
  }
  const timestamp = number(source.timestamp);
  const duration = number(source.duration);
  if (timestamp !== undefined) mapped.timestamp = timestamp;
  if (duration !== undefined) mapped.duration = duration;
  for (const field of [
    "task_count",
    "task_index",
    "tool_count",
    "duration_seconds",
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "api_calls",
    "cost_usd",
  ] as const) {
    const value = number(source[field]);
    if (value !== undefined) mapped[field] = value;
  }
  for (const field of ["files_read", "files_written"] as const) {
    const value = source[field];
    if (Array.isArray(value)) {
      mapped[field] = value.filter(
        (entry): entry is string => typeof entry === "string",
      );
    }
  }
  if (source.preview === null) mapped.preview = null;
  else if (typeof source.preview === "string") mapped.preview = source.preview;
  if (event === "tool.completed" && typeof source.error === "boolean") {
    mapped.error = source.error;
  }
  if (event === "approval.request" && Array.isArray(source.choices)) {
    const choices = source.choices.filter(
      (choice): choice is ApprovalChoice =>
        typeof choice === "string" &&
        APPROVAL_CHOICES.has(choice as ApprovalChoice),
    );
    if (choices.length) mapped.choices = choices;
  }
  if (event === "approval.responded") {
    const choice = string(source.choice);
    if (choice && APPROVAL_CHOICES.has(choice as ApprovalChoice)) {
      mapped.choice = choice as ApprovalChoice;
    }
  }
  if (event === "run.failed") {
    const error = string(source.error);
    if (error !== undefined) mapped.error = error;
  }
  const runUsage = usage(source.usage);
  if (runUsage) mapped.usage = runUsage;
  return mapped;
}

function parseSseFrame(frame: string) {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

export async function* readHermesSse(
  response: Response,
): AsyncGenerator<DeskRunEvent> {
  if (!response.body) throw new Error("Hermes returned an empty event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = mapHermesEvent(parseSseFrame(frame));
        if (event) yield event;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const event = mapHermesEvent(parseSseFrame(buffer));
      if (event) yield event;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
