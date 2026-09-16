"use client";
import { useEffect, useState, type RefObject } from "react";

/** Bind a bounded selection to the file revision that was actually displayed. */
export function useReaderSelection(
  viewport: RefObject<HTMLDivElement | null>,
  path: string,
  revision: string | undefined,
) {
  const [selection, setSelection] = useState<{
    path: string;
    revision: string | undefined;
    text: string;
  }>();
  useEffect(() => {
    setSelection(undefined);
    const range = window.getSelection();
    if (range && viewport.current?.contains(range.anchorNode))
      range.removeAllRanges();
    const update = () => {
      const range = window.getSelection();
      if (
        !range ||
        !viewport.current?.contains(range.anchorNode) ||
        !viewport.current.contains(range.focusNode)
      ) {
        setSelection(undefined);
        return;
      }
      setSelection({ path, revision, text: range.toString().slice(0, 4000) });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [viewport, path, revision]);
  return selection?.path === path && selection.revision === revision
    ? selection.text
    : "";
}
