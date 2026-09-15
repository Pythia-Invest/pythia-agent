"use client";

import { useDeskDrafts } from "@/client/providers";
import { WorkspaceReferenceCards } from "./workspace-reference-cards";
import type { WorkspaceContext } from "@/workspace/references";

import { type Attachment, attachmentLimit } from "@/attachments";
import { DraftAttachmentCard } from "./attachment-card";
import { ComposerNote } from "./chat-status";
import { useAttachments } from "./use-attachments";
import { cn, IconButton } from "@pythia/ui";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useCallback,
  useEffect,
  useSyncExternalStore,
  useRef,
  useState,
} from "react";

export interface ComposerProps {
  /** Disables sending while a prompt cannot be accepted (for example, history not loaded). */
  disabled?: boolean;
  draftKey?: string;
  onSend: (
    text: string,
    attachments?: Attachment[],
    context?: WorkspaceContext,
  ) => void | Promise<void>;
  onSteer?:
    | ((text: string, context?: WorkspaceContext) => void | Promise<void>)
    | undefined;
  /** Present while a response streams; an empty composer offers Stop. */
  onStop?: (() => void) | undefined;
  placeholder?: string;
  streaming?: boolean;
  className?: string;
  /** Run settings shown on the leading edge of the control row under the prompt. */
  controls?: ReactNode;
  /** Connection notices shown above the field. */
  notes?: ReactNode;
}

/**
 * A growing prompt inside one rounded surface, with attachments above it and
 * every control on one row beneath — attach and the run settings on the
 * leading edge, the single primary action on the other. Keeping the field a
 * clear line of its own is what makes the prompt visually dominant. The action
 * follows the Hermes desktop rule: an empty busy composer stops, while typing
 * turns the same position back into Send so the message can steer the active
 * run.
 *
 * Controls here run one step tighter than shell chrome (28px against 32px):
 * they sit inside a text field, not in a toolbar.
 */
export function Composer({
  className,
  draftKey = "new",
  controls,
  disabled = false,
  notes,
  onSend,
  onSteer,
  onStop,
  placeholder = "Ask anything",
  streaming = false,
}: ComposerProps) {
  const drafts = useDeskDrafts();
  const snapshot = useCallback(() => drafts.get(draftKey), [drafts, draftKey]);
  const draft = useSyncExternalStore(drafts.subscribe, snapshot, snapshot);
  const value = draft.text;
  const setValue = (text: string) => drafts.update(draftKey, { text });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const referenceCount = useRef(0);
  useEffect(() => {
    if (draft.context.references.length > referenceCount.current)
      textareaRef.current?.focus();
    referenceCount.current = draft.context.references.length;
  }, [draft.context.references.length]);
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachments = useAttachments({
    initial: draft.attachments,
    onChange: (files) => drafts.update(draftKey, { attachments: files }),
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const receipts = attachments.files.flatMap((entry) =>
    entry.attachment ? [entry.attachment] : [],
  );
  const limitError = attachmentLimit(receipts);
  const hasContent =
    value.trim().length > 0 ||
    attachments.files.length > 0 ||
    draft.context.references.length > 0;
  const canSend =
    !disabled &&
    !submitting &&
    hasContent &&
    attachments.ready &&
    !limitError &&
    (!streaming || (Boolean(onSteer) && attachments.files.length === 0));
  const showStop = streaming && !hasContent;

  const submit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (streaming && onSteer) await onSteer(value.trim(), draft.context);
      else await onSend(value.trim(), receipts, draft.context);
      setValue("");
      attachments.clear();
      drafts.update(draftKey, { context: { references: [] } });
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "The message could not be sent.",
      );
    } finally {
      setSubmitting(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const addFiles = (files: File[]) => {
    if (disabled || streaming || submitting) return;
    attachments.add(files);
    textareaRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className={cn("flex flex-col gap-1", className)}
      data-slot="composer"
      data-draft-key={draftKey}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled && !streaming && !submitting) setDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor={id}>
        Message Pythia
      </label>
      {/* Everything that would stop a send is said above the field, where the
          eye already is on the way to it. */}
      {notes}
      {submitError || attachments.error || limitError ? (
        <ComposerNote>
          {submitError ?? attachments.error ?? limitError ?? ""}
        </ComposerNote>
      ) : null}
      {streaming && attachments.files.length ? (
        <ComposerNote>
          Attachments can be sent when this reply finishes.
        </ComposerNote>
      ) : null}
      <div
        className={cn(
          "motion-fast flex flex-col gap-1.5 rounded-container border border-border bg-raised px-2.5 pt-2.5 pb-2 transition-colors focus-within:border-border-strong",
          dragging && "border-info bg-info-surface",
        )}
        data-slot="composer-input"
      >
        <WorkspaceReferenceCards
          context={draft.context}
          onChange={(context) => drafts.update(draftKey, { context })}
        />
        {attachments.files.length ? (
          <ul
            aria-label="Attachments"
            className="m-0 flex max-h-48 list-none flex-wrap gap-1 overflow-y-auto px-0.5"
          >
            {attachments.files.map((entry) => (
              <DraftAttachmentCard
                entry={entry}
                key={entry.key}
                onRemove={() => attachments.remove(entry.key)}
                onRetry={() => attachments.retry(entry)}
              />
            ))}
          </ul>
        ) : null}
        {dragging ? (
          <p
            className="m-0 px-1 text-foreground-secondary text-xs"
            role="status"
          >
            Drop files to attach
          </p>
        ) : null}
        <input
          aria-label="Attach files"
          className="sr-only"
          disabled={disabled || streaming || submitting}
          multiple
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        <textarea
          aria-label="Message Pythia"
          className="field-sizing-content max-h-[min(12.5rem,25dvh)] min-h-[1.375rem] min-w-0 resize-none border-0 bg-transparent px-1 pt-0.5 font-reading text-foreground text-reading leading-reading outline-hidden placeholder:text-foreground-disabled"
          disabled={disabled || submitting}
          id={id}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (!files.length) return;
            event.preventDefault();
            addFiles(files);
          }}
          placeholder={
            streaming && onSteer
              ? "Add direction while Pythia works"
              : placeholder
          }
          ref={textareaRef}
          rows={1}
          value={value}
        />
        <div className="flex min-w-0 items-center gap-0.5">
          <IconButton
            className="size-7 rounded-md text-foreground-secondary"
            disabled={disabled || streaming || submitting}
            label="Attach files and images"
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            type="button"
          >
            <Paperclip className="stroke-[1.6]" />
          </IconButton>
          {controls}
          <span className="min-w-0 flex-1" />
          {showStop ? (
            <IconButton
              className="size-7 shrink-0 rounded-md bg-foreground text-canvas hover:bg-foreground/85"
              label="Stop generating"
              onClick={onStop}
              size="sm"
              type="button"
            >
              <Square className="fill-current" />
            </IconButton>
          ) : (
            <IconButton
              className="size-7 shrink-0 rounded-md bg-foreground text-canvas hover:bg-foreground/85 disabled:bg-subtle disabled:text-foreground-disabled"
              disabled={!canSend}
              label="Send message"
              size="sm"
              type="submit"
            >
              <ArrowUp className="stroke-[1.8]" />
            </IconButton>
          )}
        </div>
      </div>
    </form>
  );
}
