"use client";

import { ActivityIndicator, SemanticMessage } from "@pythia/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DeskApi, DeskApiError } from "@/client/api";
import type {
  ApprovalChoice,
  DeskRunEvent,
  HermesMessage,
  RunStatus,
} from "@/server/types";
import { Composer } from "./composer";
import { useModelSelection } from "./model-picker";
import {
  ActivityEvent,
  ApprovalCard,
  Onboarding,
  RunOutcome,
} from "./presentation";

function text(value: unknown): string {
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
  return value == null ? "" : JSON.stringify(value, null, 2);
}

function terminalFromStatus(status: RunStatus): DeskRunEvent | null {
  const base = { run_id: status.run_id };
  if (status.status === "completed")
    return {
      ...base,
      event: "run.completed",
      ...(status.output !== undefined ? { output: status.output } : {}),
      ...(status.usage ? { usage: status.usage } : {}),
    };
  if (status.status === "failed")
    return {
      ...base,
      event: "run.failed",
      ...(status.error !== undefined ? { error: status.error } : {}),
      ...(status.code ? { code: status.code } : {}),
    };
  if (["cancelled", "interrupted"].includes(status.status))
    return { ...base, event: "run.cancelled" };
  return null;
}

export function Conversation({
  api,
  sessionId,
  initialPrompt,
  onChanged,
}: {
  api: DeskApi;
  sessionId: string;
  initialPrompt?: string | undefined;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<HermesMessage[]>([]);
  const { selection, incomplete } = useModelSelection();
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<DeskRunEvent[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<DeskApiError | null>(null);
  const [approvalPending, setApprovalPending] = useState(false);
  const [responded, setResponded] = useState<Record<string, ApprovalChoice>>(
    {},
  );
  const [terminal, setTerminal] = useState<DeskRunEvent | null>(null);
  const streamController = useRef<AbortController | null>(null);
  const initialSent = useRef(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      setMessages(await api.listMessages(sessionId));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof DeskApiError
          ? caught
          : new DeskApiError("Could not load this conversation.", 500),
      );
    } finally {
      setLoading(false);
    }
  }, [api, sessionId]);

  useEffect(() => {
    void loadHistory();
    return () => streamController.current?.abort();
  }, [loadHistory]);

  const finish = useCallback(
    async (event: DeskRunEvent) => {
      setTerminal(event);
      setRunId(null);
      setStopping(false);
      setApprovalPending(false);
      await loadHistory();
      onChanged();
    },
    [loadHistory, onChanged],
  );

  const recoverRun = useCallback(
    async (activeRunId: string) => {
      try {
        const status = await api.getRun(activeRunId);
        const completed = terminalFromStatus(status);
        if (completed) {
          await finish(completed);
        } else if (
          status.status === "waiting_for_approval" &&
          status.approval
        ) {
          const approval = status.approval;
          setEvents((current) => [
            ...current,
            { ...approval, run_id: activeRunId },
          ]);
        } else {
          setTerminal({
            event: "stream.disconnected",
            run_id: activeRunId,
            code: "stream_disconnected",
          });
        }
      } catch {
        setTerminal({
          event: "stream.disconnected",
          run_id: activeRunId,
          code: "stream_disconnected",
        });
      }
    },
    [api, finish],
  );

  const consumeRun = useCallback(
    async (activeRunId: string) => {
      const controller = new AbortController();
      streamController.current = controller;
      let ended = false;
      try {
        for await (const event of api.streamRun(
          activeRunId,
          controller.signal,
        )) {
          if (event.event === "message.delta") {
            setAssistantText((current) => current + (event.delta ?? ""));
            continue;
          }
          if (event.event === "run.completed") {
            setAssistantText((current) => current || event.output || "");
            ended = true;
            await finish(event);
            break;
          }
          if (["run.failed", "run.cancelled"].includes(event.event)) {
            ended = true;
            await finish(event);
            break;
          }
          if (event.event === "stream.disconnected") {
            ended = true;
            await recoverRun(activeRunId);
            break;
          }
          setEvents((current) => [...current, event]);
        }
        if (!ended && !controller.signal.aborted) await recoverRun(activeRunId);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof DeskApiError
              ? caught
              : new DeskApiError("Live updates disconnected.", 502),
          );
          await recoverRun(activeRunId);
        }
      }
    },
    [api, finish, recoverRun],
  );

  const submit = useCallback(
    async (prompt?: string) => {
      const content = (prompt ?? input).trim();
      if (!content || runId || incomplete) return;
      setInput("");
      setEvents([]);
      setAssistantText("");
      setTerminal(null);
      setError(null);
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}`, role: "user", content },
      ]);
      try {
        const run = await api.startRun(sessionId, content, selection);
        setRunId(run.run_id);
        await consumeRun(run.run_id);
      } catch (caught) {
        setRunId(null);
        setError(
          caught instanceof DeskApiError
            ? caught
            : new DeskApiError("Could not start this run.", 500),
        );
      }
    },
    [api, consumeRun, input, runId, sessionId, selection, incomplete],
  );

  useEffect(() => {
    if (!initialPrompt || initialSent.current || loading) return;
    initialSent.current = true;
    void submit(initialPrompt);
  }, [initialPrompt, loading, submit]);

  const respondToApproval = async (
    event: DeskRunEvent,
    choice: ApprovalChoice,
  ) => {
    if (!runId) return;
    setApprovalPending(true);
    try {
      await api.respondToApproval(runId, choice, event.request_id);
      setResponded((current) => ({
        ...current,
        [event.request_id ?? runId]: choice,
      }));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof DeskApiError
          ? caught
          : new DeskApiError("Could not answer the approval.", 500),
      );
    } finally {
      setApprovalPending(false);
    }
  };

  const stop = async () => {
    if (!runId || stopping) return;
    setStopping(true);
    try {
      await api.stopRun(runId);
    } catch (caught) {
      setStopping(false);
      setError(
        caught instanceof DeskApiError
          ? caught
          : new DeskApiError("Could not stop the run.", 500),
      );
    }
  };

  const approvalEvents = events.filter(
    (event) => event.event === "approval.request",
  );
  const activityEvents = events.filter(
    (event) => event.event !== "approval.request",
  );
  return (
    <div className="conversation">
      <div aria-busy={loading} aria-live="polite" className="message-scroller">
        <div className="message-list">
          {loading ? <ActivityIndicator label="Loading conversation" /> : null}
          {!loading && messages.length === 0 && !runId ? (
            <p className="conversation-empty">
              This conversation is ready for its first message.
            </p>
          ) : null}
          {messages.map((message) => (
            <StoredMessage key={message.id} message={message} />
          ))}
          {activityEvents.length ? (
            <ul aria-label="Hermes activity" className="activity-list">
              {activityEvents.map((event, index) => (
                <ActivityEvent event={event} key={`${event.event}-${index}`} />
              ))}
            </ul>
          ) : null}
          {runId && assistantText ? (
            <article className="assistant-message">
              <span className="assistant-mark" aria-hidden="true">
                P
              </span>
              <div>{assistantText}</div>
            </article>
          ) : null}
          {approvalEvents.map((event, index) => (
            <ApprovalCard
              event={event}
              key={event.request_id ?? `${event.event}-${index}`}
              onRespond={(choice) => void respondToApproval(event, choice)}
              pending={approvalPending}
              responded={responded[event.request_id ?? runId ?? ""]}
            />
          ))}
          {runId && !assistantText && !approvalEvents.length ? (
            <ActivityIndicator
              label={stopping ? "Stopping Hermes run" : "Pythia is working"}
            />
          ) : null}
          {error?.code === "model_auth_missing" ? (
            <Onboarding />
          ) : error ? (
            <SemanticMessage
              title="Pythia Desk could not continue"
              tone="error"
            >
              {error.message}
            </SemanticMessage>
          ) : null}
          {terminal ? <RunOutcome event={terminal} /> : null}
        </div>
      </div>
      <Composer
        input={input}
        onInput={setInput}
        onStop={() => void stop()}
        onSubmit={() => submit()}
        running={Boolean(runId)}
        stopping={stopping}
      />
    </div>
  );
}

function StoredMessage({ message }: { message: HermesMessage }) {
  const content = text(message.content);
  if (!content) return null;
  if (message.role === "user")
    return (
      <article className="user-message">
        <div>{content}</div>
      </article>
    );
  if (message.role === "system") return null;
  if (message.role === "tool")
    return (
      <article className="tool-message">
        <strong>{message.tool_name ?? "Tool result"}</strong>
        <pre>{content}</pre>
      </article>
    );
  return (
    <article className="assistant-message">
      <span className="assistant-mark" aria-hidden="true">
        P
      </span>
      <div>{content}</div>
    </article>
  );
}
