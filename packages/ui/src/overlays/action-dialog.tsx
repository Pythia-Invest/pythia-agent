"use client";

import { CircleCheck, CircleX, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "../actions/button";
import { Label, Textarea } from "../forms/field";
import { Dialog } from "./dialog";

/** Props for a small confirm dialog that records a note with the action. */
export interface ActionDialogProps {
  open: boolean;
  /** Asked to close (Cancel, Back, the close button, Escape); ignored while `pending`. */
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line: what confirming does. */
  description: string;
  noteLabel: string;
  notePlaceholder?: string;
  /** Longest note the owner accepts. */
  noteMaxLength?: number;
  confirmLabel: string;
  /** A primary confirm beside Cancel, or a destructive one beside Back. */
  tone?: "primary" | "danger";
  pending?: boolean;
  /** Why the last attempt did not go through; the dialog stays open. */
  error?: string | null;
  onConfirm: (note: string) => void;
}

/**
 * Confirms one back-office action (resolve, cancel, dismiss) with an optional
 * note that is recorded with it: a title, one line saying what happens, a
 * labelled note field, then Cancel (or Back) and a primary (or destructive)
 * confirm. Base UI's Dialog owns focus trapping, Escape and restoration. While
 * `pending` the dialog cannot be closed, so an answer never lands on a dialog
 * the user left; the note is cleared once a close completes, so it never
 * carries over to another record. Do keep the action itself in the owner
 * (`onConfirm`); don't use it for forms beyond one note.
 */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  noteLabel,
  notePlaceholder,
  noteMaxLength = 400,
  confirmLabel,
  tone = "primary",
  pending = false,
  error = null,
  onConfirm,
}: ActionDialogProps) {
  const [note, setNote] = useState("");
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending) onConfirm(note.trim());
  };
  const close = () => {
    if (!pending) onOpenChange(false);
  };
  const Icon = tone === "danger" ? CircleX : CircleCheck;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      onOpenChangeComplete={(next) => {
        if (!next) setNote("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup data-slot="action-dialog">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title>{title}</Dialog.Title>
                  <Dialog.Description>{description}</Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label="Close"
                  className="grid size-8 flex-none place-items-center"
                  disabled={pending}
                >
                  <X aria-hidden="true" className="size-4" />
                </Dialog.Close>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-note`}>
                  {noteLabel}
                  <span className="font-normal text-foreground-secondary">
                    {" "}
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id={`${id}-note`}
                  maxLength={noteMaxLength}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={notePlaceholder}
                  value={note}
                />
              </div>
              {error ? (
                <p role="alert" className="m-0 text-error text-xs">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  disabled={pending}
                  onClick={close}
                  type="button"
                  variant="secondary"
                >
                  {tone === "danger" ? "Back" : "Cancel"}
                </Button>
                <Button
                  disabled={pending}
                  type="submit"
                  variant={tone === "danger" ? "danger" : "primary"}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {confirmLabel}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
