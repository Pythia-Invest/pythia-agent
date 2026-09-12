import { attachmentId } from "@/attachments";
import type { ChatTransport, UIMessageChunk } from "ai";
import type { DeskApi } from "./api";
import type { RunStart, RunStatus } from "@/server/types";
import { terminalEvent } from "./run-terminal-event";
import type { DeskDataParts, DeskUIMessage } from "./chat-message";
import { userText } from "./chat-message";
import { RunEventMapper } from "./hermes-run-mapper";
import type { ModelSelection } from "@/server/model-catalog";

export { RunEventMapper } from "./hermes-run-mapper";
type DeskChunk = UIMessageChunk<unknown, DeskDataParts>;

/**
 * Whether this run's event stream is being received.
 *
 * Separate from the run's own outcome: Hermes may be working perfectly while
 * the browser has lost the stream, which is the difference between "we cannot
 * see it" and "it failed".
 */
export type StreamConnection = "ok" | "reconnecting" | "disconnected";

export interface HermesChatTransportOptions {
  /** Called once a run reaches a terminal state, with the session it belonged to. */
  onRunFinished?: (sessionId: string) => void;
  /** Called when the event stream drops, resumes, or is given up on. */
  onConnection?: (sessionId: string, state: StreamConnection) => void;
  onPendingSteer?: (sessionId: string, text: string) => void;
  selection?: () => ModelSelection | undefined;
}

const ACTIVE_RUN_PREFIX = "pythia-desk:active-run:";

function storedRun(sessionId: string) {
  try {
    return sessionStorage.getItem(`${ACTIVE_RUN_PREFIX}${sessionId}`);
  } catch {
    return null;
  }
}

function storeRun(sessionId: string, runId: string | null) {
  try {
    const key = `${ACTIVE_RUN_PREFIX}${sessionId}`;
    if (runId) sessionStorage.setItem(key, runId);
    else sessionStorage.removeItem(key);
  } catch {
    // Reconnection is best-effort when browser storage is unavailable.
  }
}

/**
 * AI SDK transport over Desk's own Hermes routes. The chat id is the Hermes
 * session id; a submit starts a run and streams its events, a reconnect
 * observes the run Hermes still holds for that session.
 */
export class HermesChatTransport implements ChatTransport<DeskUIMessage> {
  readonly #api: DeskApi;
  readonly #options: HermesChatTransportOptions;
  readonly #activeRuns = new Map<string, string>();
  readonly #creating = new Map<string, Promise<RunStart>>();
  readonly #pendingSteers = new Map<string, string[]>();

  constructor(api: DeskApi, options: HermesChatTransportOptions = {}) {
    this.#api = api;
    this.#options = options;
  }

  activeRun(sessionId: string) {
    return this.#activeRuns.get(sessionId) ?? storedRun(sessionId);
  }

  async steer(sessionId: string, input: string) {
    const runId = this.activeRun(sessionId);
    if (!runId) throw new Error("This reply is no longer accepting guidance.");
    const pending = this.#pendingSteers.get(runId) ?? [];
    pending.push(input);
    this.#pendingSteers.set(runId, pending);
    try {
      return await this.#api.steerRun(runId, input);
    } catch (error) {
      pending.splice(pending.indexOf(input), 1);
      throw error;
    }
  }

  async stop(sessionId: string) {
    const creating = this.#creating.get(sessionId);
    const runId = creating
      ? (await creating.catch(() => null))?.run_id
      : this.activeRun(sessionId);
    if (runId) await this.#api.stopRun(runId);
  }

  async sendMessages({
    chatId,
    messages,
    abortSignal,
  }: Parameters<ChatTransport<DeskUIMessage>["sendMessages"]>[0]) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const input = lastUser ? userText(lastUser) : "";
    const files = lastUser?.parts.filter((part) => part.type === "file") ?? [];
    const ids = files.map((part) => attachmentId(part.url));
    if (ids.some((id) => !id))
      throw new Error("Attach these files again before sending.");
    if (!input && !ids.length) throw new Error("There is nothing to send.");
    const selection = this.#options.selection?.();
    const creating = ids.length
      ? this.#api.startRun(chatId, input, selection, ids as string[])
      : this.#api.startRun(chatId, input, selection);
    this.#creating.set(chatId, creating);
    let run: RunStart;
    try {
      run = await creating;
    } finally {
      this.#creating.delete(chatId);
    }
    this.#activeRuns.set(chatId, run.run_id);
    storeRun(chatId, run.run_id);
    return this.#stream(chatId, run.run_id, abortSignal, selection);
  }

  async reconnectToStream({
    chatId,
    abortSignal,
  }: Parameters<ChatTransport<DeskUIMessage>["reconnectToStream"]>[0]) {
    const runId = this.activeRun(chatId);
    if (!runId) return null;
    this.#activeRuns.set(chatId, runId);
    return this.#stream(
      chatId,
      runId,
      abortSignal,
      this.#options.selection?.(),
      true,
    );
  }

  #stream(
    sessionId: string,
    runId: string,
    abortSignal: AbortSignal | undefined,
    selection?: ModelSelection,
    recovering = false,
  ): ReadableStream<DeskChunk> {
    const api = this.#api;
    const options = this.#options;
    const pendingSteers = this.#pendingSteers;
    const mapper = new RunEventMapper(runId, selection);
    const controller = new AbortController();
    const connection = (state: StreamConnection) =>
      options.onConnection?.(sessionId, state);
    const onAbort = () => controller.abort();
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
    let settled = false;
    const finish = () => {
      this.#activeRuns.delete(sessionId);
      pendingSteers.delete(runId);
      storeRun(sessionId, null);
      options.onRunFinished?.(sessionId);
    };
    return new ReadableStream<DeskChunk>({
      async start(stream) {
        const push = (chunks: DeskChunk[]) => {
          for (const chunk of chunks) stream.enqueue(chunk);
        };
        let lastApproval = "";
        const mapStatus = (status: RunStatus) => {
          if (mapper.terminal) return;
          const terminal = terminalEvent(status);
          if (terminal) {
            push(mapper.map(terminal));
            settled = true;
            if (status.pending_steer)
              options.onPendingSteer?.(sessionId, status.pending_steer);
            controller.abort();
          } else if (
            status.approval &&
            JSON.stringify(status.approval) !== lastApproval
          ) {
            lastApproval = JSON.stringify(status.approval);
            push(
              mapper.map({
                ...status.approval,
                event: "approval.request",
                run_id: runId,
              }),
            );
          }
        };
        push(mapper.start());
        try {
          // Native events are a consuming queue, not a replay log. Check status
          // before recovery and never open competing stream readers.
          if (recovering) {
            const status = await api.getRun(runId).catch(() => null);
            if (status) mapStatus(status);
          }
          const events = async () => {
            if (mapper.terminal || controller.signal.aborted) return;
            try {
              for await (const event of api.streamRun(
                runId,
                controller.signal,
              )) {
                if (mapper.terminal) break;
                if (event.event === "stream.disconnected") break;
                if (event.event === "approval.request")
                  lastApproval = JSON.stringify(event);
                const text =
                  event.event === "run.steered"
                    ? pendingSteers.get(runId)?.shift()
                    : undefined;
                push(
                  mapper.map(text === undefined ? event : { ...event, text }),
                );
                if (mapper.terminal) {
                  settled = true;
                  if (event.pending_steer)
                    options.onPendingSteer?.(sessionId, event.pending_steer);
                  controller.abort();
                  break;
                }
              }
            } catch {
              // A missing queue or broken connection says nothing about the run.
              // Status polling below remains authoritative, including approvals.
            }
            if (!mapper.terminal && !controller.signal.aborted)
              connection("reconnecting");
          };
          const poll = async () => {
            let failures = 0;
            while (!mapper.terminal && !controller.signal.aborted) {
              await pollDelay(controller.signal);
              if (controller.signal.aborted) break;
              const status = await api.getRun(runId).catch(() => null);
              if (controller.signal.aborted) break;
              if (status) {
                failures = 0;
                mapStatus(status);
              } else if (++failures >= 3) {
                connection("disconnected");
                push(mapper.disconnected(null));
                controller.abort();
              } else connection("reconnecting");
            }
          };
          await Promise.all([events(), poll()]);
          if (!mapper.terminal) push(mapper.disconnected(null));
          stream.close();
        } finally {
          abortSignal?.removeEventListener("abort", onAbort);
          controller.abort();
          if (settled) {
            connection("ok");
            finish();
          }
        }
      },
      cancel() {
        controller.abort();
      },
    });
  }
}

function pollDelay(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, 1500);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
