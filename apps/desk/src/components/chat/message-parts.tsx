"use client";

import { Button, cn } from "@pythia/ui";
import { Streamdown } from "streamdown";
import { useState } from "react";
import {
  type ApprovalData,
  type DeskUIMessage,
  NOTE_COPY,
  type RunStatusData,
  userText,
} from "@/client/chat-message";
import type { ApprovalChoice } from "@/server/types";
import { backendIdentifierLabel, formatBackendError } from "./backend-error";
import { ChatError, ChatNote } from "./chat-status";

/*
 * Streamdown guards every link behind an "Open external link?" modal. Its own
 * `onLinkCheck` hook is the way past it: answering yes opens the link in a new
 * tab straight away, with no dialog. Everything in a reply is a citation the
 * reader asked for, and the modal made following one a two-step job.
 *
 * A module constant because Streamdown compares this prop by identity when
 * deciding whether to re-render.
 */
export const LINK_SAFETY = { enabled: true, onLinkCheck: () => true } as const;

/**
 * Assistant prose. Streamdown repairs unterminated markdown while streaming.
 * It merges classes with its own tailwind-merge, which drops theme names such
 * as `text-body`; the chat surface sets face and size, this only inherits.
 */
export function AssistantText({
  streaming,
  text,
}: {
  streaming: boolean;
  text: string;
}) {
  return (
    <div
      className="min-w-0 font-reading text-reading"
      data-slot="assistant-text"
    >
      <Streamdown
        className="min-w-0 text-foreground leading-reading [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:text-primary [&_a]:underline [&_code]:rounded-control [&_code]:bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-lg [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-body [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-2 [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded-container [&_pre]:border [&_pre]:border-border [&_pre]:bg-subtle [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2.5 [&_table]:w-full [&_table]:border-collapse [&_table]:font-sans [&_table]:tabular-nums [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border [&_th]:border-border [&_th]:bg-subtle [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-start [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5"
        isAnimating={streaming}
        controls={{ code: { copy: true } }}
        linkSafety={LINK_SAFETY}
        mode={streaming ? "streaming" : "static"}
      >
        {text}
      </Streamdown>
    </div>
  );
}

const approvalLabels: Record<ApprovalChoice, string> = {
  once: "Allow once",
  session: "Allow for this chat",
  always: "Always allow",
  deny: "Deny",
};

export function ApprovalCard({
  data,
  onRespond,
  pending,
  active = true,
}: {
  data: ApprovalData;
  active?: boolean;
  onRespond: (choice: ApprovalChoice) => void;
  pending: boolean;
}) {
  const responded = data.responded;
  const open = active && !responded;
  return (
    /*
     * The card is the desk's own surface with a border that changes, not a
     * coloured panel: an open request is the one thing on screen that needs
     * an answer, and it says so by standing out from the thread rather than
     * by being tinted like a warning that has already happened.
     */
    <section
      aria-label="Approval request"
      className={cn(
        "grid gap-2.5 rounded-container border bg-raised px-3.5 py-3",
        open ? "border-warning-border" : "border-border",
      )}
      data-slot="approval-card"
      data-state={responded ? "responded" : active ? "request" : "expired"}
    >
      <div className="flex items-baseline gap-2.5">
        <p className="m-0 min-w-0 flex-1 font-semibold text-body text-foreground">
          Pythia is asking permission to continue
        </p>
        <span
          className={cn(
            "flex-none text-xs",
            open ? "text-warning" : "text-foreground-secondary",
          )}
        >
          {responded
            ? responded === "deny"
              ? "Denied"
              : approvalLabels[responded]
            : active
              ? "Waiting for you"
              : "No longer active"}
        </span>
      </div>
      {data.description ? (
        <p className="m-0 whitespace-pre-wrap text-body text-foreground-secondary leading-ui">
          {data.description}
        </p>
      ) : null}
      {data.command ? (
        <section aria-label="Command requiring approval">
          <code className="block max-h-30 overflow-auto whitespace-pre-wrap break-all rounded-md bg-subtle px-2.5 py-2 font-sans text-foreground text-xs leading-reading">
            {data.command}
          </code>
        </section>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* What the answer commits you to, beside the buttons that do it. */}
          <span className="min-w-0 flex-1 truncate text-foreground-disabled text-xs">
            Applies to this command only unless you widen it.
          </span>
          {data.choices.map((choice) => (
            <Button
              disabled={pending}
              key={choice}
              onClick={() => onRespond(choice)}
              size="sm"
              variant={choice === "once" ? "primary" : "secondary"}
            >
              {approvalLabels[choice]}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A transcript event that is neither person nor agent: Hermes switched model,
 * continued on its own, finished a delegated task, or loaded a skill. One
 * quiet left-aligned line, with the injected text a click away when there is any.
 */
export function SystemNote({ message }: { message: DeskUIMessage }) {
  const kind = message.metadata?.note;
  const text = userText(message);
  const [open, setOpen] = useState(false);
  if (!kind) return null;
  return (
    <div
      className="grid min-w-0 justify-items-start gap-1 text-start"
      data-note={kind}
      data-role="system"
      data-slot="message"
    >
      <p className="m-0 text-foreground-disabled text-xs leading-ui">
        {NOTE_COPY[kind]}
        {text ? (
          <>
            {" "}
            <button
              className="cursor-pointer border-0 bg-transparent p-0 text-foreground-disabled text-xs underline underline-offset-2 hover:text-foreground-secondary"
              onClick={() => setOpen(!open)}
              type="button"
            >
              {open ? "Hide" : "Show"}
            </button>
          </>
        ) : null}
      </p>
      {open && text ? (
        <pre className="m-0 max-h-64 w-full overflow-auto whitespace-pre-wrap rounded-container border border-border bg-subtle p-3 text-start font-reading text-foreground-secondary text-xs leading-reading">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

export function ErrorMessage({
  className,
  message,
  model,
  onRetry,
  provider,
}: {
  className?: string | undefined;
  message: string;
  model?: string | undefined;
  onRetry?: (() => void) | undefined;
  provider?: string | undefined;
}) {
  const formatted = formatBackendError(message);
  const context = [
    provider && backendIdentifierLabel(provider),
    model && backendIdentifierLabel(model),
    formatted.status && `HTTP ${formatted.status}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ChatError
      className={className}
      context={context || undefined}
      message={formatted.message}
      onRetry={onRetry}
    />
  );
}

export function RunStatusNote({
  data,
  onRetry,
}: {
  data: RunStatusData;
  onRetry?: (() => void) | undefined;
}) {
  if (data.state === "cancelled") return <ChatNote>Stopped.</ChatNote>;
  const message =
    data.message ??
    (data.state === "disconnected"
      ? "The connection to this reply was lost."
      : "Run failed.");
  return (
    <ErrorMessage
      className="my-1"
      message={message}
      model={data.model}
      onRetry={data.state === "failed" ? onRetry : undefined}
      provider={data.provider}
    />
  );
}
