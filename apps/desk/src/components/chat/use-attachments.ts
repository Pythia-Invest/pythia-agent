"use client";

import { useEffect, useRef, useState } from "react";
import { type Attachment, attachmentLimit, IMAGE_TYPES } from "@/attachments";
import { useUploadAttachment } from "@/client/queries";

export type DraftAttachment = {
  key: string;
  file: File;
  preview?: string;
  attachment?: Attachment;
  error?: string | undefined;
};

export function useAttachments() {
  const [files, setFiles] = useState<DraftAttachment[]>([]);
  const current = useRef(files);
  const requests = useRef(new Map<string, AbortController>());
  const previews = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync } = useUploadAttachment();

  const update = (next: DraftAttachment[]) => {
    current.current = next;
    setFiles(next);
  };
  useEffect(
    () => () => {
      for (const controller of requests.current.values()) controller.abort();
      requests.current.clear();
      for (const preview of previews.current.values())
        URL.revokeObjectURL(preview);
      previews.current.clear();
    },
    [],
  );

  const upload = async (entry: DraftAttachment) => {
    const controller = new AbortController();
    requests.current.set(entry.key, controller);
    update(
      current.current.map((file) =>
        file.key === entry.key ? { ...file, error: undefined } : file,
      ),
    );
    try {
      const attachment = await mutateAsync({
        file: entry.file,
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        update(
          current.current.map((file) =>
            file.key === entry.key ? { ...file, attachment } : file,
          ),
        );
    } catch (caught) {
      if (!controller.signal.aborted)
        update(
          current.current.map((file) =>
            file.key === entry.key
              ? {
                  ...file,
                  error:
                    caught instanceof Error ? caught.message : "Upload failed.",
                }
              : file,
          ),
        );
    } finally {
      if (requests.current.get(entry.key) === controller)
        requests.current.delete(entry.key);
    }
  };

  const clear = () => {
    for (const controller of requests.current.values()) controller.abort();
    requests.current.clear();
    for (const preview of previews.current.values())
      URL.revokeObjectURL(preview);
    previews.current.clear();
    update([]);
    setError(null);
  };

  return {
    files,
    error,
    clear,
    busy: files.some((file) => !file.attachment && !file.error),
    ready: files.every((file) => Boolean(file.attachment)),
    add: (incoming: File[]) => {
      const added: DraftAttachment[] = incoming.map((file) => ({
        key: crypto.randomUUID(),
        file,
      }));
      const limit = attachmentLimit(
        [...current.current, ...added].map((entry) => ({
          size: entry.file.size,
          mediaType: entry.attachment?.mediaType ?? entry.file.type,
        })),
      );
      if (limit) {
        setError(limit);
        return;
      }
      setError(null);
      const entries = added.map((entry) => {
        if (!IMAGE_TYPES.has(entry.file.type)) return entry;
        const preview = URL.createObjectURL(entry.file);
        previews.current.set(entry.key, preview);
        return { ...entry, preview };
      });
      update([...current.current, ...entries]);
      for (const entry of entries) void upload(entry);
    },
    remove: (key: string) => {
      requests.current.get(key)?.abort();
      requests.current.delete(key);
      const preview = previews.current.get(key);
      if (preview) URL.revokeObjectURL(preview);
      previews.current.delete(key);
      update(current.current.filter((file) => file.key !== key));
      setError(null);
    },
    retry: (entry: DraftAttachment) => void upload(entry),
  };
}
