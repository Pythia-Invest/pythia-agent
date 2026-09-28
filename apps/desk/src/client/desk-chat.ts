import {
  hasWorkspaceContext,
  splitWorkspaceNotes,
  type WorkspaceContext,
} from "@/workspace/references";
import type { DeskViewPublisher } from "./desk-view-publisher";
import { type Attachment, attachmentPart } from "@/attachments";
import { Chat } from "@ai-sdk/react";
import type { QueryClient } from "@tanstack/react-query";
import type { ModelSelection } from "@/server/model-catalog";
import { type DeskApi, DeskApiError } from "./api";
import type { DeskUIMessage } from "./chat-message";
import {
  appendHistory,
  prependHistory,
  reconcileCompletedHistory,
} from "./chat-reconciliation";
import { HermesChatTransport, type StreamConnection } from "./hermes-transport";
import { deskKeys, refreshMessages } from "./query-cache";
import { ChatAttention } from "./chat-attention";

/** Guidance shown the moment it is sent, until the run reports it accepted. */
export type OptimisticSteer = {
  id: string;
  text: string;
  context?: WorkspaceContext;
  /** Epoch ms it was sent, until Hermes reports when it accepted it. */
  at: number;
};

type ChatPresentation = {
  connection: StreamConnection;
  startedAt: number;
  stopping: boolean;
  stopError: string | null;
  steers: OptimisticSteer[];
};

function latestReply(messages: DeskUIMessage[]) {
  const message = messages.findLast(
    (candidate) =>
      candidate.role === "assistant" &&
      candidate.parts.some((part) => part.type === "text" && part.text.trim()),
  );
  return message
    ? JSON.stringify([
        message.id,
        message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text),
      ])
    : null;
}

/** One SDK conversation for the lifetime of the browser page, independent of
 * which route or dock currently observes it. Hermes remains the durable owner. */
export class DeskChat {
  readonly chat: Chat<DeskUIMessage>;
  readonly transport: HermesChatTransport;
  selection: ModelSelection | undefined;
  #initialized = false;
  #version = 0;
  #pendingSteer: string | undefined;
  #listeners = new Set<() => void>();
  #snapshot = {
    connection: "ok" as StreamConnection,
    startedAt: Date.now(),
    stopping: false,
    stopError: null as string | null,
    steers: [] as OptimisticSteer[],
  };

  constructor(
    api: DeskApi,
    queryClient: QueryClient,
    sessionId: string,
    history: DeskUIMessage[],
    view?: DeskViewPublisher,
    private attention?: ChatAttention,
  ) {
    this.transport = new HermesChatTransport(api, {
      selection: () => this.selection,
      ...(view
        ? {
            view: view.snapshot,
            onViewStarted: view.activate,
            onViewFinished: view.finish,
          }
        : {}),
      onConnection: (_id, connection) => this.#update({ connection }),
      onPendingSteer: (_id, text) => {
        this.#pendingSteer = text;
      },
      onRunFinished: () => {
        void queryClient.invalidateQueries({ queryKey: deskKeys.sessions });
        void queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "workspace" && query.queryKey[1] !== "text",
        });
        void queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId, "context"],
        });
        void queryClient.invalidateQueries({
          queryKey: deskKeys.messages(sessionId),
          refetchType: "none",
        });
      },
    });
    this.chat = new Chat<DeskUIMessage>({
      id: sessionId,
      messages: history,
      transport: this.transport,
      onFinish: ({ message }) => {
        this.attention?.working(sessionId, false);
        const pendingSteer = this.#pendingSteer;
        this.#pendingSteer = undefined;
        this.#update({ steers: [] });
        // Guidance accepted after the final answer was never delivered; it is
        // sent below as the next turn, so it must not also sit in this one.
        if (pendingSteer)
          this.chat.messages = this.chat.messages.map((candidate) =>
            candidate.id === message.id
              ? {
                  ...candidate,
                  // Hermes joins undelivered guidance with newlines
                  // (agent_runtime_helpers.py); match whole pieces only, so a
                  // delivered "stop" survives a pending "stop searching news".
                  parts: candidate.parts.filter(
                    (part) =>
                      part.type !== "data-steer" ||
                      !(
                        part.data.text &&
                        `\n${pendingSteer}\n`.includes(`\n${part.data.text}\n`)
                      ),
                  ),
                }
              : candidate,
          );
        if (
          message.metadata?.outcome === "completed" &&
          message.parts.some((part) => part.type === "text" && part.text.trim())
        )
          this.attention?.reply(sessionId);
        this.#update({ stopping: false });
        if (message.metadata?.outcome === "completed") {
          const version = this.#version;
          void refreshMessages(
            queryClient,
            api,
            sessionId,
            (saved) =>
              version !== this.#version ||
              reconcileCompletedHistory(
                this.chat.messages,
                saved,
                message.id,
              ) !== this.chat.messages,
          )
            .then((saved) => {
              if (version === this.#version) {
                const reconciled = reconcileCompletedHistory(
                  this.chat.messages,
                  saved,
                  message.id,
                );
                if (reconciled === this.chat.messages)
                  console.warn(
                    "Pythia completed-history reconciliation incomplete",
                    { sessionId, messageId: message.id },
                  );
                else this.chat.messages = reconciled;
              }
            })
            .catch(() => {
              // Keep private transcript/provider error text out of diagnostics.
              console.warn("Pythia completed-history read failed", {
                sessionId,
                messageId: message.id,
              });
            });
        }
        // Let the SDK finish its current request before starting accepted guidance.
        if (pendingSteer) {
          const pending = splitWorkspaceNotes(pendingSteer);
          queueMicrotask(() => this.send(pending.text, [], pending.context));
        }
      },
      onError: () => {
        this.attention?.working(sessionId, false);
        this.#update({ steers: [] });
      },
    });
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  snapshot = () => this.#snapshot;
  #update(patch: Partial<ChatPresentation>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }

  initialize(
    pending: () => {
      text: string;
      attachments: Attachment[];
      context?: WorkspaceContext;
    } | null,
  ) {
    if (this.#initialized) return;
    this.#initialized = true;
    const prompt = pending();
    if (prompt) this.send(prompt.text, prompt.attachments, prompt.context);
    else {
      this.attention?.working(
        this.chat.id,
        Boolean(this.transport.activeRun(this.chat.id)),
      );
      void this.chat.resumeStream();
    }
  }

  addHistory(history: DeskUIMessage[]) {
    const older = prependHistory(this.chat.messages, history);
    const active =
      this.chat.status === "streaming" || this.chat.status === "submitted";
    const next = active ? older : appendHistory(older, history);
    if (next !== this.chat.messages) {
      this.chat.messages = next;
      if (next !== older && latestReply(next) !== latestReply(older))
        this.attention?.reply(this.chat.id);
    }
  }

  send = (
    text: string,
    attachments: Attachment[] = [],
    context?: WorkspaceContext,
  ) => {
    this.#version += 1;
    this.attention?.working(this.chat.id, true);
    this.#update({
      startedAt: Date.now(),
      connection: "ok",
      stopping: false,
      stopError: null,
    });
    void this.chat.sendMessage({
      role: "user",
      parts: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...attachments.map(attachmentPart),
        ...(hasWorkspaceContext(context) && context
          ? [{ type: "data-workspace-context" as const, data: context }]
          : []),
      ],
    });
  };

  /** Show guidance at once; withdraw it only if Hermes turns it down. */
  steer = async (text: string, context?: WorkspaceContext) => {
    const steer: OptimisticSteer = {
      id: crypto.randomUUID(),
      text,
      at: Date.now(),
      ...(context && hasWorkspaceContext(context) ? { context } : {}),
    };
    this.#update({ steers: [...this.#snapshot.steers, steer] });
    try {
      await this.transport.steer(this.chat.id, text, context, steer.id);
    } catch (error) {
      this.#update({
        steers: this.#snapshot.steers.filter((item) => item !== steer),
      });
      // The reply finished first: what was guidance is now the next message.
      if (this.chat.status === "ready") this.send(text, [], context);
      // A run paused for approval or stopping takes no guidance; Hermes's own
      // message names the run, which means nothing to the reader.
      else if (
        error instanceof DeskApiError &&
        (error.code === "run_not_accepting_steer" ||
          error.code === "steer_not_accepted")
      )
        throw new Error(
          "Pythia can't take direction at this point in the reply.",
        );
      else throw error;
    }
  };

  retry = () => {
    if (this.chat.status === "streaming" || this.chat.status === "submitted")
      return;
    this.#version += 1;
    this.attention?.working(this.chat.id, true);
    this.#update({ startedAt: Date.now(), stopError: null });
    void this.chat.regenerate();
  };

  stop = async () => {
    if (this.#snapshot.stopping) return;
    this.#update({ stopping: true, stopError: null });
    try {
      await this.transport.stop(this.chat.id);
      // Keep observing until native terminal status. Aborting SSE is not Stop.
    } catch (error) {
      this.#update({
        stopping: false,
        stopError:
          error instanceof Error ? error.message : "Could not stop the reply.",
      });
    }
  };
}

export class DeskChats {
  #chats = new Map<string, DeskChat>();
  readonly attention = new ChatAttention();
  constructor(
    private api: DeskApi,
    private queryClient: QueryClient,
    private view?: DeskViewPublisher,
  ) {}
  get(sessionId: string, history: DeskUIMessage[]) {
    let session = this.#chats.get(sessionId);
    if (!session) {
      session = new DeskChat(
        this.api,
        this.queryClient,
        sessionId,
        history,
        this.view,
        this.attention,
      );
      this.#chats.set(sessionId, session);
    }
    return session;
  }
}
