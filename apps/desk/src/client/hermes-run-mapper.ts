import type { UIMessageChunk } from "ai";
import type { DeskRunEvent, RunStatus } from "@/server/types";
import type { DeskDataParts } from "./chat-message";
import type { ModelSelection } from "@/server/model-catalog";
import { RunDelegations } from "./run-delegations";
import { terminalEvent } from "./run-terminal-event";

type DeskChunk = UIMessageChunk<unknown, DeskDataParts>;

/** Epoch milliseconds from a Hermes epoch-seconds timestamp. */
function millis(timestamp: number | undefined) {
  return typeof timestamp === "number"
    ? Math.round(timestamp * 1000)
    : undefined;
}

/**
 * Turns one Hermes run into the AI SDK's UI message stream. Text deltas open
 * a text part, tool events become dynamic tool parts, approvals and terminal
 * failures become Desk data parts. The mapper keeps only the state a single
 * run needs and never touches Hermes shapes outside this file.
 */
export class RunEventMapper {
  #textId: string | null = null;
  #textIsPreview = false;
  #counter = 0;
  /** Text streamed since the last tool event; commentary that repeats it is noise. */
  #stepText = "";
  readonly #pendingTools = new Map<
    string,
    { toolCallId: string; startedAt: number | undefined }[]
  >();
  /** Delegated tasks Hermes reported for the open `delegate_task` calls. */
  readonly #delegations = new RunDelegations();
  readonly #ambiguousTools = new Set<string>();
  readonly #approvals = new Map<string, DeskDataParts["approval"]>();
  readonly #runId: string;
  readonly #selection: ModelSelection | undefined;
  terminal = false;

  constructor(runId: string, selection?: ModelSelection) {
    this.#runId = runId;
    this.#selection = selection;
  }

  #id(prefix: string) {
    this.#counter += 1;
    return `${this.#runId}:${prefix}:${this.#counter}`;
  }

  #closeText(out: DeskChunk[]) {
    if (this.#textId) {
      out.push({ type: "text-end", id: this.#textId });
      out.push({ type: "finish-step" });
      this.#textId = null;
      this.#textIsPreview = false;
    }
  }

  start(): DeskChunk[] {
    return [{ type: "start", messageId: this.#runId }];
  }

  #openCommentary(out: DeskChunk[], text: string) {
    this.#closeText(out);
    const id = this.#id("text");
    out.push(
      { type: "start-step" },
      {
        type: "text-start",
        id,
        providerMetadata: { pythia: { preview: true } },
      },
      { type: "text-delta", id, delta: text },
    );
    this.#textId = id;
    this.#textIsPreview = true;
    this.#stepText = text;
  }

  #openTool(
    out: DeskChunk[],
    toolName: string,
    preview: string | null,
    timing: { startedAt: number | undefined },
  ) {
    this.#closeText(out);
    this.#stepText = "";
    const toolCallId = this.#id("tool");
    const entry = { toolCallId, startedAt: timing.startedAt };
    const queue = this.#pendingTools.get(toolName) ?? [];
    if (queue.length) this.#ambiguousTools.add(toolName);
    queue.push(entry);
    this.#pendingTools.set(toolName, queue);
    out.push({
      type: "tool-input-available",
      toolCallId,
      toolName,
      input: preview ? { preview } : {},
      toolMetadata:
        timing.startedAt === undefined ? {} : { startedAt: timing.startedAt },
      dynamic: true,
    });
    return entry;
  }

  /**
   * How long the turn took, from Hermes' own event timestamps.
   *
   * `run.completed` carries no duration, so it is measured across the stream.
   * Hermes does not replay events. Duration covers only the events observed
   * by this mapper; a status-only recovery has no measured duration.
   */
  #firstEventAt: number | undefined;

  #runDuration(event: DeskRunEvent) {
    const endedAt = millis(event.timestamp);
    if (this.#firstEventAt === undefined || endedAt === undefined) return {};
    return { durationSeconds: (endedAt - this.#firstEventAt) / 1000 };
  }

  map(event: DeskRunEvent): DeskChunk[] {
    const out: DeskChunk[] = [];
    if (this.#firstEventAt === undefined)
      this.#firstEventAt = millis(event.timestamp);
    switch (event.event) {
      case "message.delta": {
        if (!event.delta) break;
        if (this.#textIsPreview) {
          this.#closeText(out);
          this.#stepText = "";
        }
        if (!this.#textId) {
          this.#textId = this.#id("text");
          out.push(
            { type: "start-step" },
            { type: "text-start", id: this.#textId },
          );
        }
        this.#stepText += event.delta;
        out.push({ type: "text-delta", id: this.#textId, delta: event.delta });
        break;
      }
      case "reasoning.available": {
        const text = event.text?.trim() ?? "";
        // Native conversation_loop emits up to 500 characters of the current
        // assistant content after stripping these tags, even after streaming it.
        const streamed = this.#stepText
          .replace(/<\/?(?:REASONING_SCRATCHPAD|think|reasoning)>/gu, "")
          .trim();
        const alreadyStreamed =
          !this.#textIsPreview && streamed.startsWith(text);
        if (text && !alreadyStreamed && text !== this.#stepText)
          this.#openCommentary(out, text);
        break;
      }
      case "tool.started": {
        this.#openTool(out, event.tool ?? "tool", event.preview ?? null, {
          startedAt: millis(event.timestamp),
        });
        break;
      }
      case "subagent.start": {
        // Hermes narrates each delegated task; attach it to the open
        // delegate_task call, or stand one up when the call itself was filtered.
        const open =
          this.#pendingTools.get("delegate_task")?.at(-1) ??
          this.#openTool(out, "delegate_task", null, {
            startedAt: millis(event.timestamp),
          });
        out.push(...this.#delegations.start(event, open.toolCallId));
        break;
      }
      case "subagent.complete": {
        const open = this.#pendingTools.get("delegate_task")?.at(-1);
        if (!open) break;
        out.push(...this.#delegations.complete(event, open.toolCallId));
        break;
      }
      case "tool.completed": {
        const toolName = event.tool ?? "tool";
        const pending = this.#pendingTools.get(toolName)?.shift();
        if (!pending) break;
        // This API has no call IDs: overlapping same-name calls cannot be
        // correlated safely. History will supply their actual outcomes.
        if (this.#ambiguousTools.has(toolName)) break;
        const output = "";
        const completedAt =
          millis(event.timestamp) ??
          (pending.startedAt !== undefined && event.duration !== undefined
            ? pending.startedAt + Math.round(event.duration * 1000)
            : undefined);
        const toolMetadata: Record<string, number> = {};
        if (event.duration !== undefined)
          toolMetadata.durationSeconds = event.duration;
        if (pending.startedAt !== undefined)
          toolMetadata.startedAt = pending.startedAt;
        if (completedAt !== undefined) toolMetadata.completedAt = completedAt;
        if (event.error === true) {
          out.push({
            type: "tool-output-error",
            toolCallId: pending.toolCallId,
            errorText: "The tool reported an error.",
            providerMetadata: { pythia: toolMetadata },
            dynamic: true,
          });
        } else {
          // Hermes streams no result body; the row shows the call and its timing.
          out.push({
            type: "tool-output-available",
            toolCallId: pending.toolCallId,
            output,
            providerMetadata: { pythia: toolMetadata },
            dynamic: true,
          });
        }
        break;
      }
      case "approval.request": {
        this.#closeText(out);
        this.#stepText = "";
        const data: DeskDataParts["approval"] = {
          runId: this.#runId,
          ...(event.request_id ? { requestId: event.request_id } : {}),
          ...(event.description ? { description: event.description } : {}),
          ...(event.command ? { command: event.command } : {}),
          choices: event.choices?.length ? event.choices : ["deny"],
        };
        if (event.request_id) this.#approvals.set(event.request_id, data);
        out.push({
          type: "data-approval",
          id: `approval:${event.request_id ?? this.#id("approval")}`,
          data,
        });
        break;
      }
      case "approval.responded": {
        if (!event.request_id || !event.choice) break;
        out.push({
          type: "data-approval",
          id: `approval:${event.request_id}`,
          data: {
            ...this.#approvals.get(event.request_id),
            runId: this.#runId,
            requestId: event.request_id,
            choices: [],
            responded: event.choice,
          },
        });
        break;
      }
      case "run.steered": {
        if (!event.text) break;
        out.push({
          type: "data-steer",
          id: this.#id("steer"),
          data: { text: event.text },
        });
        break;
      }
      case "run.completed": {
        // AI SDK text deltas append. Its native reset-step replaces only the
        // current text step, preserving earlier commentary, tools and approvals.
        if (
          event.output !== undefined &&
          (event.output !== this.#stepText || this.#textIsPreview)
        ) {
          if (this.#textId) {
            out.push({ type: "reset-step" });
            this.#textId = null;
          } else {
            out.push({ type: "start-step" });
          }
          const id = this.#id("text");
          out.push(
            { type: "text-start", id },
            { type: "text-delta", id, delta: event.output },
            { type: "text-end", id },
            { type: "finish-step" },
          );
        } else {
          this.#closeText(out);
        }
        out.push({
          type: "finish",
          messageMetadata: {
            outcome: "completed",
            run: {
              ...this.#runDuration(event),
              ...(event.usage ? { usage: event.usage } : {}),
              ...(this.#selection?.model
                ? { model: this.#selection.model }
                : {}),
              ...(this.#selection?.provider
                ? { provider: this.#selection.provider }
                : {}),
            },
          },
        });
        this.terminal = true;
        break;
      }
      case "run.failed":
      case "run.cancelled": {
        this.#closeText(out);
        out.push({
          type: "data-run-status",
          id: this.#id("status"),
          data: {
            state: event.event === "run.failed" ? "failed" : "cancelled",
            ...(typeof event.error === "string"
              ? { message: event.error }
              : {}),
            ...(event.code ? { code: event.code } : {}),
            ...(this.#selection?.provider
              ? { provider: this.#selection.provider }
              : {}),
            ...(this.#selection?.model ? { model: this.#selection.model } : {}),
          },
        });
        out.push({ type: "finish-step" }, { type: "finish" });
        this.terminal = true;
        break;
      }
      default:
        break;
    }
    return out;
  }

  /** Closes the stream when Hermes stopped talking without a terminal event. */
  disconnected(status: RunStatus | null): DeskChunk[] {
    if (status) {
      const synthetic = terminalEvent(status);
      if (synthetic) return this.map(synthetic);
    }
    const out: DeskChunk[] = [];
    this.#closeText(out);
    out.push(
      {
        type: "data-run-status",
        id: this.#id("status"),
        data: { state: "disconnected", code: "stream_disconnected" },
      },
      { type: "finish-step" },
      { type: "finish" },
    );
    this.terminal = true;
    return out;
  }
}
