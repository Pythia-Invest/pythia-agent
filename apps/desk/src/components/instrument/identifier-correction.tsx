"use client";

import type { CorrectionView } from "@pythia/market-data/subject";
import { Button, Input } from "@pythia/ui";
import { useEffect, useRef, useState } from "react";
import type { CorrectFn } from "@/client/corrections";

const LINK =
  "underline underline-offset-2 outline-ring hover:text-foreground focus-visible:outline-2";

/** The investor's correction of one identifier, beside it in the header: an
 * Edit link opens an inline input (empty removes the identifier), and a
 * corrected identifier says so with an Undo. `subjectId` is the subject the
 * scheme identifies (the security for an ISIN, the issuer for an LEI); without
 * one, or without `onCorrect`, nothing is editable. Core refuses a value that
 * is malformed for its scheme and says why. */
export function IdentifierCorrection({
  label,
  scheme,
  value,
  subjectId,
  corrected,
  onCorrect,
}: {
  label: string;
  scheme: string;
  value: string | null | undefined;
  subjectId: string | null;
  corrected: CorrectionView | null;
  onCorrect?: CorrectFn | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const run = async (request: Parameters<CorrectFn>[0], done: () => void) => {
    if (!onCorrect) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const text = await onCorrect(request);
      done();
      // Core's note that another subject also holds the value.
      if (/also held/u.test(text)) setMessage({ error: false, text });
    } catch (error) {
      setMessage({
        error: true,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };
  const editable = Boolean(onCorrect && subjectId);
  if (editing && subjectId)
    return (
      <form
        data-slot="instrument-identifier-edit"
        className="flex min-w-0 flex-wrap items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            { kind: "identifier", subjectId, scheme, value: draft.trim() },
            () => setEditing(false),
          );
        }}
      >
        <Input
          ref={input}
          size="sm"
          aria-label={`${label}; leave empty to remove it`}
          placeholder="Empty removes it"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          className="h-7 w-56 font-mono"
        />
        <Button size="sm" type="submit" loading={busy}>
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        {message ? (
          <span role="alert" className="text-error">
            {message.text}
          </span>
        ) : null}
      </form>
    );
  return (
    <>
      {corrected ? (
        <span
          data-slot="instrument-identifier-corrected"
          className="text-foreground-secondary"
        >
          {corrected.value ? "Corrected by you" : "Removed by you"}
          {onCorrect ? (
            <>
              {" · "}
              <button
                type="button"
                aria-label={`Undo the correction of ${label}`}
                disabled={busy}
                onClick={() =>
                  void run({ action: "undo", id: corrected.id }, () => {})
                }
                className={LINK}
              >
                Undo
              </button>
            </>
          ) : null}
        </span>
      ) : null}
      {editable ? (
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onClick={() => {
            setDraft(value ?? "");
            setMessage(undefined);
            setEditing(true);
          }}
          className={`${LINK} text-foreground-secondary`}
        >
          Edit
        </button>
      ) : null}
      {message ? (
        <span
          role={message.error ? "alert" : "status"}
          className={message.error ? "text-error" : "text-foreground-secondary"}
        >
          {message.text}
        </span>
      ) : null}
    </>
  );
}
