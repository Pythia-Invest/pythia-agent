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
    setSubmitError(null);
    if (streaming && onSteer) {
      // Guidance is shown at once. The field is free for the next thought, and
      // gets this one back only if the run turns it down.
      const text = value.trim();
      const context = draft.context;
      drafts.update(draftKey, { text: "", context: { references: [] } });
      try {
        await onSteer(text, context);
      } catch (error) {
        // Never lose words: put the message back ahead of anything typed since.
        const current = drafts.get(draftKey);
        drafts.update(draftKey, {
          text: current.text ? `${text}\n${current.text}` : text,
          context: current.context.references.length
            ? current.context
            : context,
        });
        setSubmitError(
          error instanceof Error
            ? error.message
            : "The message could not be sent.",
        );
      }
      return;
    }
    setSubmitting(true);
    try {
      await onSend(value.trim(), receipts, draft.context);
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
          "motion-fast flex flex-col gap-2 rounded-container border border-transparent bg-subtle/60 px-3 pt-3 pb-2 transition-colors dark:bg-subtle",
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
          className="field-sizing-content max-h-[min(12.5rem,25dvh)] min-h-[1.375rem] min-w-0 resize-none border-0 bg-transparent px-1 pt-0.5 text-foreground text-reading leading-reading outline-hidden placeholder:text-foreground-disabled"
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
        <div className="flex min-w-0 items-center gap-1">
          <IconButton
            className="-ms-1 size-8 rounded-pill text-foreground-secondary hover:text-foreground"
            disabled={disabled || streaming || submitting}
            label="Attach files and images"
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            type="button"
          >
            <Paperclip className="stroke-[1.6]" />
          </IconButton>
          <span className="min-w-0 flex-1" />
          {controls}
          {showStop ? (
            <IconButton
              className="ms-1 size-8 shrink-0 rounded-full bg-foreground text-canvas transition-[transform,background-color] hover:bg-foreground/85 active:scale-92"
              label="Stop generating"
              onClick={onStop}
              size="sm"
              type="button"
            >
              <Square className="scale-75 fill-current motion-safe:animate-pop" />
            </IconButton>
          ) : (
            <IconButton
              className="ms-1 size-8 shrink-0 rounded-full bg-foreground text-canvas transition-[transform,background-color] hover:bg-foreground/85 active:scale-92 disabled:bg-foreground/15 disabled:text-canvas disabled:opacity-100"
              disabled={!canSend}
              label="Send message"
              size="sm"
              type="submit"
            >
              <ArrowUp className="stroke-[1.8] motion-safe:animate-pop" />
            </IconButton>
          )}
        </div>
      </div>
    </form>
  );
}
