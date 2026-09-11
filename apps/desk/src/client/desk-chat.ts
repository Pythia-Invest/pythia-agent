import { type Attachment, attachmentPart } from "@/attachments";
import { Chat } from "@ai-sdk/react";
import type { QueryClient } from "@tanstack/react-query";
import type { ModelSelection } from "@/server/model-catalog";
import type { DeskApi } from "./api";
import type { DeskUIMessage } from "./chat-message";
import {
  appendHistory,
  prependHistory,
  reconcileCompletedHistory,
} from "./chat-reconciliation";
import { HermesChatTransport, type StreamConnection } from "./hermes-transport";
import { deskKeys, refreshMessages } from "./query-cache";

type ChatPresentation = {
  connection: StreamConnection;
  startedAt: number;
  stopping: boolean;
  stopError: string | null;
};

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
  };

  constructor(
    api: DeskApi,
    queryClient: QueryClient,
    sessionId: string,
    history: DeskUIMessage[],
  ) {
    this.transport = new HermesChatTransport(api, {
      selection: () => this.selection,
      onConnection: (_id, connection) => this.#update({ connection }),
      onPendingSteer: (_id, text) => {
        this.#pendingSteer = text;
      },
      onRunFinished: () => {
        void queryClient.invalidateQueries({ queryKey: deskKeys.sessions });
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
        this.#update({ stopping: false });
        if (message.metadata?.outcome === "completed") {
          const version = this.#version;
          void refreshMessages(queryClient, api, sessionId)
            .then((saved) => {
              if (version === this.#version)
                this.chat.messages = reconcileCompletedHistory(
                  this.chat.messages,
                  saved,
                  message.id,
                );
            })
            .catch(() => {
              /* Keep the streamed answer if enrichment fails. */
            });
        }
        const text = this.#pendingSteer;
        this.#pendingSteer = undefined;
        // Let the SDK finish its current request before starting accepted guidance.
        if (text) queueMicrotask(() => this.send(text));
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
    pending: () => { text: string; attachments: Attachment[] } | null,
  ) {
    if (this.#initialized) return;
    this.#initialized = true;
    const prompt = pending();
    if (prompt) this.send(prompt.text, prompt.attachments);
    else void this.chat.resumeStream();
  }

  addHistory(history: DeskUIMessage[]) {
    const older = prependHistory(this.chat.messages, history);
    const active =
      this.chat.status === "streaming" || this.chat.status === "submitted";
    const next = active ? older : appendHistory(older, history);
    if (next !== this.chat.messages) this.chat.messages = next;
  }

  send = (text: string, attachments: Attachment[] = []) => {
    this.#version += 1;
    this.#update({
      startedAt: Date.now(),
      connection: "ok",
      stopping: false,
      stopError: null,
    });
    void this.chat.sendMessage({
      text,
      files: attachments.map(attachmentPart),
    });
  };

  retry = () => {
    if (this.chat.status === "streaming" || this.chat.status === "submitted")
      return;
    this.#version += 1;
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
  constructor(
    private api: DeskApi,
    private queryClient: QueryClient,
  ) {}
  get(sessionId: string, history: DeskUIMessage[]) {
    let session = this.#chats.get(sessionId);
    if (!session) {
      session = new DeskChat(this.api, this.queryClient, sessionId, history);
      this.#chats.set(sessionId, session);
    }
    return session;
  }
}
