"use client";

import { IconButton, Textarea } from "@pythia/ui";
import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { SendIcon, StopIcon } from "./icons";
import { ModelPicker, useModelSelection } from "./model-picker";

export function Composer({
  disabled = false,
  input,
  running,
  stopping,
  onInput,
  onStop,
  onSubmit,
}: {
  disabled?: boolean;
  input: string;
  running: boolean;
  stopping: boolean;
  onInput: (value: string) => void;
  onStop?: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { incomplete } = useModelSelection();
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "0px";
    ref.current.style.height = `${Math.min(ref.current.scrollHeight, 180)}px`;
  }, [input]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || running || incomplete) return;
    void onSubmit();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (disabled || running || incomplete) return;
      void onSubmit();
    }
  };
  return (
    <div className="composer-region">
      <form className="composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="chat-message">
          Message Pythia
        </label>
        <Textarea
          className="composer-input"
          disabled={disabled || running}
          id="chat-message"
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={keyDown}
          placeholder="Message Pythia"
          ref={ref}
          rows={1}
          value={input}
        />
        {running ? (
          <IconButton
            disabled={stopping}
            label={stopping ? "Stopping run" : "Stop run"}
            onClick={onStop}
            size="sm"
            type="button"
            variant="primary"
          >
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            disabled={disabled || incomplete || !input.trim()}
            label="Send message"
            size="sm"
            type="submit"
            variant="primary"
          >
            <SendIcon />
          </IconButton>
        )}
      </form>
      <ModelPicker disabled={disabled || running} />
      <p className="composer-note">
        Pythia can make mistakes. Check important investment decisions.
      </p>
    </div>
  );
}
