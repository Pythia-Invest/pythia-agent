import type { ChatTransport, UIMessageChunk } from "ai";
import type { DeskRunEvent, RunStatus } from "@/server/types";
import type { DeskApi } from "./api";
import type { DeskDataParts, DeskUIMessage } from "./chat-message";
import { userText } from "./chat-message";

type DeskChunk = UIMessageChunk<unknown, DeskDataParts>;

/**
 * Turns one Hermes run into the AI SDK's UI message stream. Text deltas open
 * a text part, tool events become dynamic tool parts, approvals and terminal
 * failures become Desk data parts. The mapper keeps only the state a single
 * run needs and never touches Hermes shapes outside this file.
 */
export class RunEventMapper {
  #textId: string | null = null;
  #textSeen = false;
  #counter = 0;
  readonly #pendingTools = new Map<string, string[]>();
  readonly #runId: string;
  terminal = false;

  constructor(runId: string) {
    this.#runId = runId;
  }

  #id(prefix: string) {
    this.#counter += 1;
    return `${this.#runId}:${prefix}:${this.#counter}`;
  }

  #closeText(out: DeskChunk[]) {
    if (this.#textId) {
      out.push({ type: "text-end", id: this.#textId });
      this.#textId = null;
    }
  }

  start(): DeskChunk[] {
    return [{ type: "start" }, { type: "start-step" }];
  }

  map(event: DeskRunEvent): DeskChunk[] {
    const out: DeskChunk[] = [];
    switch (event.event) {
      case "message.delta": {
        if (!event.delta) break;
        if (!this.#textId) {
          this.#textId = this.#id("text");
          out.push({ type: "text-start", id: this.#textId });
        }
        this.#textSeen = true;
        out.push({ type: "text-delta", id: this.#textId, delta: event.delta });
        break;
      }
      case "reasoning.available": {
        if (!event.text) break;
        this.#closeText(out);
        const id = this.#id("reasoning");
        out.push(
          { type: "reasoning-start", id },
          { type: "reasoning-delta", id, delta: event.text },
          { type: "reasoning-end", id },
        );
        break;
      }
      case "tool.started": {
        this.#closeText(out);
        const toolName = event.tool ?? "tool";
        const toolCallId = this.#id("tool");
        const queue = this.#pendingTools.get(toolName) ?? [];
        queue.push(toolCallId);
        this.#pendingTools.set(toolName, queue);
        out.push({
          type: "tool-input-available",
          toolCallId,
          toolName,
          input: event.preview ? { preview: event.preview } : {},
          dynamic: true,
        });
        break;
      }
      case "tool.completed": {
        const toolName = event.tool ?? "tool";
        const toolCallId = this.#pendingTools.get(toolName)?.shift();
        if (!toolCallId) break;
        if (event.error === true) {
          out.push({
            type: "tool-output-error",
            toolCallId,
            errorText: "The tool reported an error.",
            dynamic: true,
          });
        } else {
          out.push({
            type: "tool-output-available",
            toolCallId,
            output:
              event.duration !== undefined ? { duration: event.duration } : {},
            dynamic: true,
          });
        }
        break;
      }
      case "approval.request": {
        this.#closeText(out);
        out.push({
          type: "data-approval",
          id: `approval:${event.request_id ?? this.#id("approval")}`,
          data: {
            runId: this.#runId,
            ...(event.request_id ? { requestId: event.request_id } : {}),
            ...(event.description ? { description: event.description } : {}),
            choices: event.choices?.length
              ? event.choices
              : ["once", "session", "always", "deny"],
          },
        });
        break;
      }
      case "approval.responded": {
        if (!event.request_id || !event.choice) break;
        out.push({
          type: "data-approval",
          id: `approval:${event.request_id}`,
          data: {
            runId: this.#runId,
            requestId: event.request_id,
            choices: [],
            responded: event.choice,
          },
        });
        break;
      }
      case "run.completed": {
        if (!this.#textSeen && event.output) {
          const id = this.#id("text");
          out.push(
            { type: "text-start", id },
            { type: "text-delta", id, delta: event.output },
            { type: "text-end", id },
          );
        } else {
          this.#closeText(out);
        }
        out.push({ type: "finish-step" }, { type: "finish" });
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

function terminalEvent(status: RunStatus): DeskRunEvent | null {
  const base = { run_id: status.run_id };
  if (status.status === "completed") {
    return {
      ...base,
      event: "run.completed",
      ...(status.output !== undefined ? { output: status.output } : {}),
    };
  }
  if (status.status === "failed") {
    return {
      ...base,
      event: "run.failed",
      ...(status.error !== undefined ? { error: status.error } : {}),
      ...(status.code ? { code: status.code } : {}),
    };
  }
  if (["cancelled", "interrupted"].includes(status.status)) {
    return { ...base, event: "run.cancelled" };
  }
  return null;
}

export interface HermesChatTransportOptions {
  /** Called once a run reaches a terminal state, with the session it belonged to. */
  onRunFinished?: (sessionId: string) => void;
}

/**
 * AI SDK transport over Desk's own Hermes routes. The chat id is the Hermes
 * session id; a submit starts a run and streams its events, a reconnect
 * replays the run Hermes still holds for that session.
 */
export class HermesChatTransport implements ChatTransport<DeskUIMessage> {
  readonly #api: DeskApi;
  readonly #options: HermesChatTransportOptions;
  readonly #activeRuns = new Map<string, string>();

  constructor(api: DeskApi, options: HermesChatTransportOptions = {}) {
    this.#api = api;
    this.#options = options;
  }

  activeRun(sessionId: string) {
    return this.#activeRuns.get(sessionId) ?? null;
  }

  async sendMessages({
    chatId,
    messages,
    abortSignal,
  }: Parameters<ChatTransport<DeskUIMessage>["sendMessages"]>[0]) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const input = lastUser ? userText(lastUser) : "";
    if (!input) throw new Error("There is nothing to send.");
    const run = await this.#api.startRun(chatId, input);
    this.#activeRuns.set(chatId, run.run_id);
    return this.#stream(chatId, run.run_id, abortSignal);
  }

  async reconnectToStream({
    chatId,
    abortSignal,
  }: Parameters<ChatTransport<DeskUIMessage>["reconnectToStream"]>[0]) {
    const runId = this.#activeRuns.get(chatId);
    if (!runId) return null;
    return this.#stream(chatId, runId, abortSignal);
  }

  #stream(
    sessionId: string,
    runId: string,
    abortSignal: AbortSignal | undefined,
  ): ReadableStream<DeskChunk> {
    const api = this.#api;
    const mapper = new RunEventMapper(runId);
    const controller = new AbortController();
    const finish = () => {
      this.#activeRuns.delete(sessionId);
      this.#options.onRunFinished?.(sessionId);
    };
    const onAbort = () => {
      controller.abort();
      // A dropped SSE connection does not stop a Hermes run; ask explicitly.
      void api.stopRun(runId).catch(() => undefined);
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    return new ReadableStream<DeskChunk>({
      async start(stream) {
        const push = (chunks: DeskChunk[]) => {
          for (const chunk of chunks) stream.enqueue(chunk);
        };
        push(mapper.start());
        try {
          for await (const event of api.streamRun(runId, controller.signal)) {
            push(mapper.map(event));
            if (mapper.terminal) break;
          }
          if (!mapper.terminal) {
            const status = await api.getRun(runId).catch(() => null);
            push(mapper.disconnected(status));
          }
          stream.close();
        } catch (error) {
          if (controller.signal.aborted) {
            push(mapper.disconnected(null));
            stream.close();
          } else {
            stream.error(error);
          }
        } finally {
          abortSignal?.removeEventListener("abort", onAbort);
          finish();
        }
      },
      cancel() {
        controller.abort();
      },
    });
  }
}
