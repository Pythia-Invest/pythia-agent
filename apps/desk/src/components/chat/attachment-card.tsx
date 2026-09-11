"use client";

import { Alert, Button, Dialog, IconButton } from "@pythia/ui";
import { FileText, RefreshCw, X, LoaderCircle, Download } from "lucide-react";
import { useState } from "react";
import type { FileUIPart } from "ai";
import { IMAGE_TYPES, attachmentId } from "@/attachments";
import { useDownloadAttachment } from "@/client/queries";
import type { DraftAttachment } from "./use-attachments";

function Preview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <FileText
      aria-hidden="true"
      className="size-5 shrink-0 text-foreground-secondary"
    />
  ) : (
    // Local originals and browser-created blob previews; no remote image fetches.
    <img
      alt=""
      className="size-12 shrink-0 rounded-control object-cover"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

export function DraftAttachmentCard({
  entry,
  onRemove,
  onRetry,
}: {
  entry: DraftAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const uploading = !entry.attachment && !entry.error;
  return (
    <li
      className="flex w-60 max-w-full shrink-0 items-center gap-2 rounded-control border border-border bg-canvas p-2"
      data-slot="draft-attachment"
    >
      {entry.preview ? (
        <Preview src={entry.preview} />
      ) : (
        <FileText
          aria-hidden="true"
          className="size-5 shrink-0 text-foreground-secondary"
        />
      )}
      <div className="min-w-0 flex-1">
        <p
          className="m-0 truncate text-foreground text-xs"
          title={entry.file.name}
        >
          {entry.file.name}
        </p>
        <p
          aria-live="polite"
          className="m-0 mt-0.5 text-foreground-secondary text-xs"
        >
          {entry.error ??
            (uploading
              ? "Uploading…"
              : `${Math.max(1, Math.round(entry.file.size / 1024))} KB`)}
        </p>
      </div>
      {uploading ? (
        <LoaderCircle
          aria-label="Uploading"
          className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {entry.error ? (
        <IconButton
          label={`Retry ${entry.file.name}`}
          onClick={onRetry}
          size="sm"
          type="button"
        >
          <RefreshCw />
        </IconButton>
      ) : null}
      <IconButton
        className="size-6 shrink-0"
        label={`Remove ${entry.file.name}`}
        onClick={onRemove}
        size="sm"
        type="button"
      >
        <X />
      </IconButton>
    </li>
  );
}

export function MessageAttachment({ part }: { part: FileUIPart }) {
  const [open, setOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const download = useDownloadAttachment();
  const image = IMAGE_TYPES.has(part.mediaType);
  const id = attachmentId(part.url);
  const safeInline =
    image && /^data:image\/(?:png|jpeg|gif|webp);base64,/u.test(part.url);
  const name = part.filename ?? "Attachment";
  if (!id && !safeInline) return null;
  const save = async () => {
    try {
      const blob = id ? await download.mutateAsync(id) : null;
      const url = blob ? URL.createObjectURL(blob) : part.url;
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      if (blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* The mutation's native error is shown beside the attachment. */
    }
  };
  return (
    <div className="grid max-w-64 gap-1" data-slot="message-attachment">
      <Button
        className="h-auto justify-start gap-2 p-2 font-normal"
        disabled={download.isPending}
        onClick={() => (image ? setOpen(true) : void save())}
        variant="secondary"
      >
        {image ? (
          <Preview src={part.url} />
        ) : (
          <FileText
            aria-hidden="true"
            className="size-5 shrink-0 text-foreground-secondary"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
        {!image ? (
          <Download
            aria-hidden="true"
            className="size-3.5 shrink-0 text-foreground-secondary"
          />
        ) : null}
      </Button>
      {download.error ? (
        <p className="m-0 text-error text-xs" role="alert">
          {download.error.message}
        </p>
      ) : null}
      {image ? (
        <Dialog.Root onOpenChange={setOpen} open={open}>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Viewport>
              <Dialog.Popup className="grid w-[min(56rem,100%)] gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Dialog.Title className="min-w-0 truncate text-sm">
                    {name}
                  </Dialog.Title>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      disabled={download.isPending}
                      label={`Download ${name}`}
                      onClick={() => void save()}
                      size="sm"
                    >
                      <Download />
                    </IconButton>
                    <Dialog.Close
                      render={
                        <IconButton label="Close image preview" size="sm">
                          <X />
                        </IconButton>
                      }
                    />
                  </div>
                </div>
                <Dialog.Description className="sr-only">
                  Attached image preview
                </Dialog.Description>
                {previewFailed ? (
                  <Alert
                    title="This image is missing or no longer readable."
                    tone="error"
                  />
                ) : (
                  <img
                    alt={name}
                    className="max-h-[70dvh] w-full rounded-control object-contain"
                    onError={() => setPreviewFailed(true)}
                    src={part.url}
                  />
                )}
                {download.error ? (
                  <p className="m-0 text-error text-xs" role="alert">
                    {download.error.message}
                  </p>
                ) : null}
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
