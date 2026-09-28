"use client";

import { useCodeHighlight } from "@/components/workspace/previews/code";

import { CHAT_MARKDOWN_SANITIZER } from "@/components/workspace/markdown-policy";

import { ChatArtifactLink } from "@/components/workspace/workspace-link";
import { rehypeCitations } from "./citations";
import { Button, cn } from "@pythia/ui";
import { Streamdown } from "streamdown";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
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
// Citations are marked after sanitizing, so the mark survives to the link.
const ARTIFACT_REHYPE = [CHAT_MARKDOWN_SANITIZER, rehypeCitations];

type Cell<T extends "table" | "thead" | "tbody" | "tr" | "th" | "td"> =
  ComponentProps<T> & { node?: unknown };

/*
 * Tables are Desk's own markup rather than Streamdown's framed widget: quiet
 * row rules, no outer frame or fixed height, every row readable in place,
 * horizontal scroll only when the columns genuinely do not fit.
 */
function ChatTable({
  node: _node,
  className: _className,
  ...props
}: Cell<"table">) {
  return (
    <div className="my-3 max-w-full overflow-x-auto" data-slot="chat-table">
      <table
        className="w-full border-collapse font-sans text-body tabular-nums leading-ui"
        {...props}
      />
    </div>
  );
}

function ChatTableHead({
  node: _node,
  className: _className,
  ...props
}: Cell<"thead">) {
  return <thead {...props} />;
}

function ChatTableBody({
  node: _node,
  className: _className,
  ...props
}: Cell<"tbody">) {
  return <tbody {...props} />;
}

function ChatTableRow({
  node: _node,
  className: _className,
  ...props
}: Cell<"tr">) {
  return (
    <tr
      className="border-border border-b last:border-b-0 [thead_&]:border-border-strong"
      {...props}
    />
  );
}

function ChatTableHeader({
  node: _node,
  className: _className,
  ...props
}: Cell<"th">) {
  return (
    <th
      className="whitespace-nowrap px-3 py-2 text-start align-bottom font-medium text-foreground-secondary first:ps-0 last:pe-0"
      {...props}
    />
  );
}

function ChatTableCell({
  node: _node,
  className: _className,
  ...props
}: Cell<"td">) {
  return (
    <td
      className="px-3 py-2 align-top text-foreground first:ps-0 last:pe-0"
      {...props}
    />
  );
}

const ARTIFACT_COMPONENTS = {
  a: ChatArtifactLink,
  table: ChatTable,
  thead: ChatTableHead,
  tbody: ChatTableBody,
  tr: ChatTableRow,
  th: ChatTableHeader,
  td: ChatTableCell,
};

export const LINK_SAFETY = { enabled: true, onLinkCheck: () => true } as const;

/**
 * Assistant prose. Streamdown repairs unterminated markdown while streaming.
 * It merges classes with its own tailwind-merge, which drops theme names such
 * as `text-body`; the chat surface sets face and size, this only inherits.
 */
/** Streaming words fade in; a module constant because Streamdown compares by identity. */
const WORD_FADE = { animation: "fadeIn", duration: 280, sep: "word" } as const;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function AssistantText({
  streaming,
  text,
}: {
  streaming: boolean;
  text: string;
}) {
  const code = useCodeHighlight(/```|~~~/.test(text) && text.length <= 100_000);
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div
      className="min-w-0 font-reading text-reading"
      data-slot="assistant-text"
    >
      <Streamdown
        plugins={code ? { code } : {}}
        components={ARTIFACT_COMPONENTS}
        rehypePlugins={ARTIFACT_REHYPE}
        skipHtml
        className="min-w-0 text-foreground leading-reading [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_code]:rounded-control [&_code]:bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-lg [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-body [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-outside [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-2 [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded-container [&_pre]:border [&_pre]:border-border [&_pre]:bg-subtle [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-2 [&_ul]:list-outside [&_ul]:list-disc [&_ul]:ps-5"
        isAnimating={streaming}
        animated={streaming && !reducedMotion ? WORD_FADE : false}
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

/** Machine notices whose text is addressed to the agent, never to the reader. */
const AGENT_ADDRESSED = new Set([
  "async_delegation_complete",
  "async_delegation_incomplete",
  "internal_notification",
]);

/**
 * A transcript event that is neither person nor agent: Hermes switched model,
 * continued on its own, finished background research, or loaded a skill. One
 * quiet line. Injected text a reader can use is a click away; notices written
 * for the agent (result dumps, file paths) are not offered at all.
 */
/** A timeline event in the conversation: a centred label on a hairline. */
export function TimelineDivider({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-3 text-foreground-secondary text-xs leading-ui before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
      {children}
    </p>
  );
}

export function SystemNote({ message }: { message: DeskUIMessage }) {
  const kind = message.metadata?.note;
  const text = AGENT_ADDRESSED.has(kind ?? "") ? "" : userText(message);
  const [open, setOpen] = useState(false);
  if (!kind) return null;
  return (
    <div
      className="grid min-w-0 gap-1 pb-5 text-start"
      data-note={kind}
      data-role="system"
      data-slot="message"
    >
      <TimelineDivider>
        {NOTE_COPY[kind]}
        {text ? (
          <button
            className="-ms-1.5 cursor-pointer border-0 bg-transparent p-0 text-foreground-secondary text-xs underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            type="button"
          >
            {open ? "Hide" : "Show"}
          </button>
        ) : null}
      </TimelineDivider>
      {open && text ? (
        <p className="m-0 max-h-64 w-full overflow-auto whitespace-pre-wrap text-start text-body text-foreground-secondary leading-reading">
          {text}
        </p>
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
