import type { HermesMessage, HermesSession, RunUsage } from "./types";

export class HermesApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "HermesApiError";
    this.status = status;
    this.code = code;
  }
}

/** Tolerant readers for the records Hermes returns; unknown fields are ignored. */
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function boolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function nullableString(value: unknown) {
  return value === null ? null : string(value);
}

export function usage(value: unknown): RunUsage | undefined {
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

export function runError(value: unknown) {
  const error = string(value);
  return error === undefined ? {} : { error };
}

export function session(value: unknown): HermesSession {
  const source = object(value);
  const id = string(source.id);
  if (!id)
    throw new HermesApiError(
      "Hermes returned a session without an identifier.",
      502,
    );
  const result: HermesSession = { id };
  const title = nullableString(source.title);
  const lastActive = number(source.last_active);
  const preview = nullableString(source.preview);
  const messageCount = number(source.message_count);
  const endedAt = number(source.ended_at);
  if (title !== undefined) result.title = title;
  if (lastActive !== undefined) result.last_active = lastActive;
  if (preview !== undefined) result.preview = preview;
  if (messageCount !== undefined) result.message_count = messageCount;
  if (endedAt !== undefined) result.ended_at = endedAt;
  return result;
}

export function message(value: unknown, index: number): HermesMessage {
  const source = object(value);
  const result: HermesMessage = {
    id: String(source.id ?? `message-${index}`),
    role: string(source.role) ?? "assistant",
    content: source.content ?? "",
  };
  const timestamp = number(source.timestamp);
  const toolCallId = nullableString(source.tool_call_id);
  const toolName = nullableString(source.tool_name);
  const finishReason = nullableString(source.finish_reason);
  const displayKind = nullableString(source.display_kind);
  const reasoning =
    nullableString(source.reasoning) ??
    nullableString(source.reasoning_content);
  if (timestamp !== undefined) result.timestamp = timestamp;
  if (reasoning) result.reasoning = reasoning;
  if (toolCallId !== undefined) result.tool_call_id = toolCallId;
  if (toolName !== undefined) result.tool_name = toolName;
  if (source.tool_calls !== undefined) result.tool_calls = source.tool_calls;
  if (finishReason !== undefined) result.finish_reason = finishReason;
  if (displayKind) result.display_kind = displayKind;
  return result;
}
