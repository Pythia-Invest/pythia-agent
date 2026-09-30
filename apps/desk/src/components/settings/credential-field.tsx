"use client";

import { Button, IconButton, Input } from "@pythia/ui";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { CredentialState } from "./fields";

/**
 * A credential in place, after Hermes Desktop's KeyField
 * (apps/desktop/src/app/settings/credential-key-ui.tsx, MIT): a stored value
 * reads as its stand-in and edits on focus; Save appears once something is
 * typed, Remove when a value is stored, and Escape cancels. The value is
 * never shown again once saved.
 */
export function CredentialField({
  label,
  state,
  secret,
  placeholder,
  pending,
  onSave,
}: {
  label: string;
  state: CredentialState;
  secret: boolean;
  placeholder?: string | undefined;
  pending: boolean;
  /** Resolves to null once saved, or to why it wasn't. */
  onSave: (value: string | null) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;
  const dirty = Boolean(draft?.trim());
  const save = (value: string | null) =>
    void onSave(value).then((failure) => {
      setError(failure);
      if (!failure) setDraft(null);
    });

  const message = error ? (
    <p role="alert" className="m-0 mt-1.5 text-error text-xs">
      {error}
    </p>
  ) : null;
  if (state.set && !editing)
    return (
      <div className="grid w-full">
        <Input
          aria-label={label}
          readOnly
          size="sm"
          className="cursor-pointer text-foreground-secondary"
          value={state.display ?? (secret ? "••••••••" : "Set")}
          onFocus={() => setDraft("")}
        />
        {message}
      </div>
    );

  return (
    <div className="grid w-full">
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Input
          aria-label={label}
          autoComplete="off"
          // Focus follows a click on the stored value into its editor.
          autoFocus={editing}
          disabled={pending}
          placeholder={placeholder ?? `Paste ${label}`}
          size="sm"
          type={secret ? "password" : "text"}
          value={draft ?? ""}
          onFocus={() => {
            if (!editing) setDraft("");
          }}
          onBlur={() => {
            if (!dirty && state.set) setDraft(null);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && dirty) {
              event.preventDefault();
              save(draft?.trim() ?? null);
            } else if (event.key === "Escape" && editing) {
              // Cancel the edit, not the whole Settings window.
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
            }
          }}
        />
        {editing && (state.set || dirty) ? (
          <div className="flex items-center gap-1">
            {state.set ? (
              <IconButton
                label={`Remove ${label}`}
                size="sm"
                disabled={pending}
                className="text-foreground-secondary hover:text-error"
                // Keep focus from leaving the field before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => save(null)}
              >
                <Trash2 className="stroke-[1.6]" />
              </IconButton>
            ) : null}
            {dirty ? (
              <Button
                size="sm"
                loading={pending}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => save(draft?.trim() ?? null)}
              >
                Save
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {message}
    </div>
  );
}
