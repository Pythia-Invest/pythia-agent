import { splitAttachmentNote, IMAGE_TYPES } from "@/attachments";
import type { DynamicToolUIPart, UIMessage } from "ai";
import type { ApprovalChoice, HermesMessage, RunUsage } from "@/server/types";

/**
 * The browser's conversation model is the AI SDK `UIMessage`. Everything
 * Hermes-specific is confined to custom data parts and to the transport
 * that produces them, so another harness only needs a new transport.
 */
export type ApprovalData = {
  runId: string;
  requestId?: string;
  description?: string;
  command?: string;
  choices: ApprovalChoice[];
  responded?: ApprovalChoice;
};

export type RunStatusData = {
  state: "failed" | "cancelled" | "disconnected";
  message?: string;
  code?: string;
  provider?: string;
  model?: string;
};

export type DeskDataParts = {
  approval: ApprovalData;
  "run-status": RunStatusData;
  steer: { text: string };
};

/**
 * Hermes stores some rows with the user role that no person typed: the
 * runtime switched model, continued on its own, reported a delegated task, or
 * injected a skill. They become system notes rather than user bubbles.
 */
export const NOTE_COPY = {
  async_delegation_complete: "A delegated task finished",
  auto_continue: "Continued automatically",
  internal_notification: "Runtime notification",
  model_switch: "Model switched",
  personality_switch: "Personality switched",
  skill_invocation: "Skill loaded",
} as const;

export type NoteKind = keyof typeof NOTE_COPY;

export type DeskMetadata = {
  /** Native rows folded into this message, in transcript order. */
  historyRows?: string[];
  note?: NoteKind;
  outcome?: "completed";
  run?: {
    usage?: RunUsage;
    model?: string;
    provider?: string;
    /** Wall-clock seconds from the run's first event to its terminal one. */
    durationSeconds?: number;
  };
};

export type DeskUIMessage = UIMessage<DeskMetadata, DeskDataParts>;

function noteKind(row: HermesMessage): NoteKind | null {
  const kind = row.display_kind;
  return kind && kind in NOTE_COPY ? (kind as NoteKind) : null;
}

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
  result?: { output: string },
): DynamicToolUIPart {
  const base = {
    type: "dynamic-tool" as const,
    toolCallId: call.id,
    toolName: call.name,
    input: call.input,
  };
  return result
    ? { ...base, state: "output-available", output: result.output }
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
    // Compaction carriers and interrupt placeholders: Hermes projects them to
    // empty hidden rows so every transcript surface drops them.
    if (row.display_kind === "hidden") continue;
    if (row.role === "user") {
      closeTurn();
      const content = splitAttachmentNote(messageText(row.content));
      const text = content.text;
      const note = noteKind(row);
      if (note) {
        messages.push({
          id: row.id,
          role: "system",
          metadata: { note, historyRows: [row.id] },
          parts: text ? [{ type: "text", text }] : [],
        });
        continue;
      }
      const files = content.files;
      // Native images from another Hermes surface may have no Desk receipt.
      if (!files.length && Array.isArray(row.content)) {
        for (const part of row.content) {
          const url =
            part?.type === "image_url" ? part.image_url?.url : undefined;
          const mediaType =
            typeof url === "string"
              ? /^data:([^;]+);base64,/u.exec(url)?.[1]
              : undefined;
          if (mediaType && IMAGE_TYPES.has(mediaType))
            files.push({ type: "file", mediaType, url, filename: "Image" });
        }
      }
      if (!text && !files.length) continue;
      messages.push({
        id: row.id,
        role: "user",
        metadata: { historyRows: [row.id] },
        parts: [...(text ? [{ type: "text" as const, text }] : []), ...files],
      });
      continue;
    }
    if (row.role !== "assistant" && row.role !== "tool") continue;

    if (row.role === "tool") {
      if (!turn) continue;
      turn.message.metadata?.historyRows?.push(row.id);
      const callId = row.tool_call_id ?? "";
      const pending = turn.calls.get(callId);
      if (pending) {
        turn.message.parts[pending.index] = toolPart(pending.call, {
          output: messageText(row.content),
        });
        turn.calls.delete(callId);
      }
      continue;
    }

    if (!turn) {
      turn = {
        message: {
          id: row.id,
          role: "assistant",
          parts: [],
          metadata: { historyRows: [] },
        },
        calls: new Map(),
      };
    }
    turn.message.metadata?.historyRows?.push(row.id);
    const reasoning = row.reasoning?.trim();
    if (reasoning) {
      turn.message.parts.push({
        type: "reasoning",
        text: reasoning,
        state: "done",
      });
    }
    const text = messageText(row.content);
    if (text) {
      turn.message.parts.push({ type: "text", text, state: "done" });
    }
    for (const call of parseToolCalls(row.tool_calls, row.id)) {
      turn.calls.set(call.id, {
        call,
        index: turn.message.parts.length,
      });
      turn.message.parts.push(toolPart(call));
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
