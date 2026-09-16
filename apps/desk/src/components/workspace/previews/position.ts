"use client";
import { useCallback, useRef, useState } from "react";
import type { WorkspaceEntry } from "@/workspace/types";
import { useWorkspaceReader, type PreviewPosition } from "../reader-context";

/** Only small view settings survive a tab switch. Parsed data/workers still unmount. */
export function usePreviewPosition(
  entry: Pick<WorkspaceEntry, "path" | "revision">,
) {
  const reader = useWorkspaceReader();
  const [position, setPosition] = useState<PreviewPosition>(
    () =>
      reader?.getPreviewPosition(entry.path, entry.revision) ?? {
        page: 1,
        sheet: 0,
        rowPage: 0,
        zoom: null,
        rotation: 0,
        fitPage: false,
        textView: false,
      },
  );
  const current = useRef(position);
  const save = reader?.savePreviewPosition;
  const update = useCallback(
    (patch: Partial<PreviewPosition>) => {
      const next = { ...current.current, ...patch };
      current.current = next;
      save?.(entry.path, entry.revision, next);
      setPosition(next);
    },
    [entry.path, entry.revision, save],
  );
  return [position, update] as const;
}
