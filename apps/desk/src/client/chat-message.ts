import type { DynamicToolUIPart, UIMessage } from "ai";
import type { ApprovalChoice, HermesMessage } from "@/server/types";

/**
 * The browser's conversation model is the AI SDK `UIMessage`. Everything
 * Hermes-specific is confined to two custom data parts and to the transport
 * that produces them, so another harness only needs a new transport.
 */
export type ApprovalData = {
  runId: string;
  requestId?: string;
  description?: string;
  choices: ApprovalChoice[];
  responded?: ApprovalChoice;
};

export type RunStatusData = {
  state: "failed" | "cancelled" | "disconnected";
  message?: string;
  code?: string;
};

export type DeskDataParts = {
  approval: ApprovalData;
  "run-status": RunStatusData;
};

export type DeskUIMessage = UIMessage<unknown, DeskDataParts>;

/** Plain text of a Hermes message body, whatever shape the provider stored. */
export function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

type ToolCallRecord = {
  id: string;
  name: string;
  input: unknown;
};

function parseToolCalls(value: unknown, messageId: string): ToolCallRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const fn =
      record.function && typeof record.function === "object"
        ? (record.function as Record<string, unknown>)
        : record;
    const name =
      typeof fn.name === "string" ? fn.name : String(record.name ?? "tool");
    let input: unknown = fn.arguments ?? record.arguments ?? record.input;
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        // Keep the raw string when the provider stored non-JSON arguments.
      }
    }
    return [
      {
        id: String(record.id ?? `${messageId}-tool-${index}`),
        name,
        input: input ?? {},
      },
    ];
  });
}

function toolPart(
  call: ToolCallRecord,
  output: unknown,
  hasOutput: boolean,
): DynamicToolUIPart {
  const base = {
    type: "dynamic-tool" as const,
    toolCallId: call.id,
    toolName: call.name,
    input: call.input,
  };
  return hasOutput
    ? { ...base, state: "output-available", output }
    : { ...base, state: "input-available" };
}

/**
 * Folds the Hermes transcript into UI messages. Consecutive assistant and
 * tool rows form one assistant turn, the way the model produced them, and
 * tool results attach to the call that requested them.
 */
export function historyToMessages(history: HermesMessage[]): DeskUIMessage[] {
  const messages: DeskUIMessage[] = [];
  let turn: {
    message: DeskUIMessage;
    calls: Map<string, { call: ToolCallRecord; index: number }>;
  } | null = null;

  const closeTurn = () => {
    if (turn?.message.parts.length) messages.push(turn.message);
    turn = null;
  };

  for (const row of history) {
    if (row.role === "user") {
      closeTurn();
      const text = messageText(row.content);
      if (!text) continue;
      messages.push({
        id: row.id,
        role: "user",
        parts: [{ type: "text", text }],
      });
      continue;
    }
    if (row.role !== "assistant" && row.role !== "tool") continue;

    if (row.role === "tool") {
      if (!turn) continue;
      const callId = row.tool_call_id ?? "";
      const pending = turn.calls.get(callId);
      if (pending) {
        turn.message.parts[pending.index] = toolPart(
          pending.call,
          messageText(row.content),
          true,
        );
        turn.calls.delete(callId);
      }
      continue;
    }

    if (!turn) {
      turn = {
        message: { id: row.id, role: "assistant", parts: [] },
        calls: new Map(),
      };
    }
    const text = messageText(row.content);
    if (text) turn.message.parts.push({ type: "text", text, state: "done" });
    for (const call of parseToolCalls(row.tool_calls, row.id)) {
      turn.calls.set(call.id, {
        call,
        index: turn.message.parts.length,
      });
      turn.message.parts.push(toolPart(call, undefined, false));
    }
  }
  closeTurn();
  return messages;
}

/** Text a person typed, from the parts of a user message. */
export function userText(message: DeskUIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}
