"use client";

import { useState } from "react";
import { SemanticMessage } from "@pythia/ui";
import { Composer } from "./composer";

export function NewConversation({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (prompt: string) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const prompt = input.trim();
    if (!prompt || disabled || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(prompt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="new-conversation">
      <div className="welcome">
        <span className="assistant-mark" aria-hidden="true">
          P
        </span>
        <h1>What are we working on?</h1>
        <p>
          Ask Pythia to research a company, examine evidence, or revisit your
          investment reasoning.
        </p>
      </div>
      {error ? (
        <div className="top-message">
          <SemanticMessage
            title="Could not start this conversation"
            tone="error"
          >
            {error} Your message is still here; you can retry.
          </SemanticMessage>
        </div>
      ) : null}
      <Composer
        disabled={disabled || submitting}
        input={input}
        onInput={setInput}
        onSubmit={submit}
        running={false}
        stopping={false}
      />
    </div>
  );
}
