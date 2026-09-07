"use client";

import { cn, IconButton } from "@pythia/ui";
import { ArrowUp, Square } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";

export interface ComposerProps {
  /** Disables sending while a prompt cannot be accepted (for example, history not loaded). */
  disabled?: boolean;
  onSend: (text: string) => void | Promise<void>;
  /** Present while a response streams; turns the send control into Stop. */
  onStop?: (() => void) | undefined;
  placeholder?: string;
  streaming?: boolean;
  className?: string;
}

/**
 * ChatGPT-style prompt box: a growing textarea inside one rounded surface with
 * a single round action at the end. Enter sends, Shift+Enter breaks a line.
 */
export function Composer({
  className,
  disabled = false,
  onSend,
  onStop,
  placeholder = "Ask anything",
  streaming = false,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const canSend = !disabled && !streaming && value.trim().length > 0;

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    setValue("");
    void onSend(text);
    textareaRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className={cn(
        "motion-fast flex items-end gap-2 rounded-[1.625rem] border border-border bg-raised py-2 pr-2 pl-4 shadow-popup transition-colors focus-within:border-border-strong",
        className,
      )}
      data-slot="composer"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor={id}>
        Message Pythia
      </label>
      <textarea
        aria-label="Message Pythia"
        className="field-sizing-content max-h-52 min-h-8 flex-1 resize-none self-center border-0 bg-transparent py-1 text-body text-foreground leading-ui outline-hidden placeholder:text-foreground-disabled"
        disabled={disabled}
        id={id}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      {streaming ? (
        <IconButton
          className="rounded-full bg-foreground text-canvas hover:bg-foreground/85"
          label="Stop generating"
          onClick={onStop}
          size="sm"
          type="button"
        >
          <Square className="fill-current" />
        </IconButton>
      ) : (
        <IconButton
          className="rounded-full bg-foreground text-canvas hover:bg-foreground/85 disabled:bg-subtle disabled:text-foreground-disabled"
          disabled={!canSend}
          label="Send message"
          size="sm"
          type="submit"
        >
          <ArrowUp />
        </IconButton>
      )}
    </form>
  );
}
