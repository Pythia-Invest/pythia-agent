import {
  splitWorkspaceNotes,
  hasWorkspaceContext,
  type WorkspaceContext,
} from "@/workspace/references";
import { splitAttachmentNote, IMAGE_TYPES } from "@/attachments";
import type { DynamicToolUIPart, UIMessage } from "ai";
import type { ApprovalChoice, HermesMessage, RunUsage } from "@/server/types";
import type { WorkAgent } from "@/work/types";

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

/** Guidance the user sent while a run was working. */
export type SteerData = {
  text: string;
  context?: WorkspaceContext;
  /** Epoch ms Hermes accepted (live) or delivered (saved) it. */
  at?: number;
  /** Seconds the run had worked since the turn or the previous steer. */
  worked?: number;
};

export type DeskDataParts = {
  approval: ApprovalData;
  "run-status": RunStatusData;
  steer: SteerData;
  "workspace-context": WorkspaceContext;
  agent: WorkAgent;
};

/**
 * Hermes stores some rows with the user role that no person typed: the
 * runtime switched model, continued on its own, reported a delegated task, or
 * injected a skill. They become system notes rather than user bubbles.
 */
export const NOTE_COPY = {
  async_delegation_complete: "Research agents finished",
  async_delegation_incomplete: "Not every research agent finished",
  auto_continue: "Continued automatically",
  internal_notification: "Background work finished",
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
    /** Epoch ms the answer was completed. */
    completedAt?: number;
  };
};

export type DeskUIMessage = UIMessage<DeskMetadata, DeskDataParts>;

/**
 * Hermes re-enters finished background delegations as synthetic user rows.
 * Its gateway marks them `internal_notification`, but the API-server path in
 * this pin stores them unmarked, so its fixed notice headers identify them.
 */
const DELEGATION_NOTICE = /^\s*\[ASYNC DELEGATION (?:BATCH )?COMPLETE\b/u;
const BACKGROUND_NOTICE =
  /^\s*\[IMPORTANT: (?:Background process|\d+ background (?:processes|subagent delegations))\b/u;

function noteKind(row: HermesMessage, text: string): NoteKind | null {
  const kind = row.display_kind;
  // A delegation's outcome is only in its text, whatever the row is marked.
  if (kind && kind in NOTE_COPY && kind !== "async_delegation_complete")
    return kind as NoteKind;
  // A batch marks each task ✓, ✗ or ⚠ (truncated), and a failed batch with an
  // ERROR block; a single delegation reports its `Status:` line.
  if (DELEGATION_NOTICE.test(text) || kind === "async_delegation_complete")
    return /^--- (?:✗|⚠|ERROR)|^Status: (?!completed\b|success\b)/mu.test(text)
      ? "async_delegation_incomplete"
      : "async_delegation_complete";
  if (BACKGROUND_NOTICE.test(text)) return "internal_notification";
  return null;
}

/** Hermes wraps mid-run guidance in this fixed out-of-band marker (`format_steer_marker`). */
const STEER_MARKER =
  /\n*\[OUT-OF-BAND USER MESSAGE\b[^\]\n]*\]\n([\s\S]*?)\n\[\/OUT-OF-BAND USER MESSAGE\]/gu;

export function splitSteers(output: string) {
  const steers: string[] = [];
  const text = output.replace(STEER_MARKER, (_, steer: string) => {
    if (steer.trim()) steers.push(steer.trim());
    return "";
  });
  return { text, steers };
}

export function steerData(text: string, at?: number, worked?: number) {
  const steer = splitWorkspaceNotes(text);
  return {
    text: steer.text,
    ...(hasWorkspaceContext(steer.context) ? { context: steer.context } : {}),
    ...(at === undefined ? {} : { at }),
    ...(worked === undefined || worked < 0 ? {} : { worked }),
  } satisfies SteerData;
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

export function parseToolCalls(
  value: unknown,
  messageId: string,
): ToolCallRecord[] {
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
    endedAt?: number;
    steeredAt?: number;
  } | null = null;
  /** When the row that prompted the next reply was saved, in epoch seconds. */
  let promptedAt: number | undefined;

  const closeTurn = () => {
    if (turn?.message.parts.length) {
      // A saved turn keeps its "worked for" time: prompt row to last reply row.
      if (turn.endedAt !== undefined && turn.message.metadata) {
        const seconds =
          promptedAt === undefined ? 0 : turn.endedAt - promptedAt;
        turn.message.metadata.run = {
          ...turn.message.metadata.run,
          completedAt: turn.endedAt * 1000,
          ...(seconds > 0 ? { durationSeconds: seconds } : {}),
        };
      }
      messages.push(turn.message);
    }
    turn = null;
  };

  for (const row of history) {
    // Compaction carriers and interrupt placeholders: Hermes projects them to
    // empty hidden rows so every transcript surface drops them.
    if (row.display_kind === "hidden") continue;
    // Mid-run guidance: Hermes (v2026.9.11+) saves it as its own typed user
    // row after the tool result it followed. It belongs to the running turn.
    if (row.role === "user" && row.display_kind === "steer" && turn) {
      const at = row.timestamp ?? undefined;
      const since = turn.steeredAt ?? promptedAt;
      turn.message.metadata?.historyRows?.push(row.id);
      for (const steer of splitSteers(messageText(row.content)).steers)
        turn.message.parts.push({
          type: "data-steer",
          id: row.id,
          data: steerData(
            steer,
            at === undefined ? undefined : at * 1000,
            at === undefined || since === undefined ? undefined : at - since,
          ),
        });
      if (at !== undefined) turn.steeredAt = at;
      continue;
    }
    if (row.role === "user") {
      closeTurn();
      promptedAt = row.timestamp ?? undefined;
      const content = splitAttachmentNote(messageText(row.content));
      const workspace = splitWorkspaceNotes(content.text);
      const text = workspace.text;
      const note = noteKind(row, text);
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
      const referencePart = hasWorkspaceContext(workspace.context)
        ? [{ type: "data-workspace-context" as const, data: workspace.context }]
        : [];
      if (!text && !files.length && !referencePart.length) continue;
      messages.push({
        id: row.id,
        role: "user",
        metadata: { historyRows: [row.id] },
        parts: [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...files,
          ...referencePart,
        ],
      });
      continue;
    }
    if (row.role !== "assistant" && row.role !== "tool") continue;
    if (turn && typeof row.timestamp === "number") turn.endedAt = row.timestamp;

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
    if (typeof row.timestamp === "number") turn.endedAt = row.timestamp;
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

/** Reference metadata accompanies typed text; it never becomes attachment bytes. */
export function userWorkspaceContext(
  message: DeskUIMessage,
): WorkspaceContext | undefined {
  return message.parts.find((part) => part.type === "data-workspace-context")
    ?.data;
}
