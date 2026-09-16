"use client";

import { useReaderSelection } from "./use-reader-selection";
import { Button } from "@pythia/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useWorkspaceEntry, useWorkspaceText } from "@/client/queries";
import { workspaceUrl } from "@/workspace/paths";
import type { WorkspaceEntry } from "@/workspace/types";
import {
  useWorkspaceReader,
  type WorkspaceLocation,
  type ReadingPosition,
} from "./reader-context";
import { WorkspaceDirectory } from "./workspace-browser";
import { WorkspacePreview } from "./workspace-preview";
import { WorkspaceToolbar } from "./workspace-toolbar";
import { StrategyBriefAction } from "./strategies/strategy-context";
import { useStartStrategy } from "./strategies/use-start-strategy";

/** Metadata changes automatically load the latest bytes while retaining a practical reading anchor. */
export function WorkspaceReader({
  path,
  heading,
  onOpen,
  placement = "standalone",
}: WorkspaceLocation & {
  onOpen: (location: WorkspaceLocation) => void;
  placement?: "standalone" | "companion";
}) {
  const entry = useWorkspaceEntry(path);
  const startStrategy = useStartStrategy();
  const [chosen, setChosen] = useState<WorkspaceEntry>();
  const displayed = chosen?.path === path ? chosen : entry.data;
  const content = useWorkspaceText(
    path,
    displayed?.revision ?? "",
    Boolean(
      displayed?.previewable && ["markdown", "text"].includes(displayed.kind),
    ),
  );
  const textual =
    displayed?.previewable && ["markdown", "text"].includes(displayed.kind);
  const displayedRevision =
    textual && content.data ? content.data.revision : displayed?.revision;
  const [updatedPath, setUpdatedPath] = useState<string | null>(null);
  const updated = updatedPath === path && displayed?.kind !== "directory";
  const jumpedToHeading = useRef<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const selectedText = useReaderSelection(viewport, path, displayedRevision);
  const restore = useRef<{
    path: string;
    revision: string;
    top: number;
    id?: string;
    offset?: number;
  } | null>(null);
  const reader = useWorkspaceReader();
  const setView = reader?.setView;
  const getReadingPosition = reader?.getReadingPosition;
  const saveReadingPosition = reader?.saveReadingPosition;
  const tabRestore = useRef<ReadingPosition | null>(null);
  const [readyRevision, setReadyRevision] = useState<string>();
  const previewReady =
    !displayed?.previewable ||
    !["pdf", "csv", "spreadsheet", "document", "notebook"].includes(
      displayed.kind,
    ) ||
    readyRevision === displayed.revision;
  const onPreviewReady = useCallback(
    () => setReadyRevision(displayed?.revision),
    [displayed?.revision],
  );
  const currentHeading = useRef(heading);
  currentHeading.current = heading;
  useLayoutEffect(
    () => () => {
      const element = viewport.current;
      // Capture before unmount even if the browser has not delivered its scroll event.
      if (element?.isConnected && !tabRestore.current)
        saveReadingPosition?.(path, {
          top: element.scrollTop,
          left: element.scrollLeft,
          heading: currentHeading.current,
        });
    },
    [path, saveReadingPosition],
  );
  const folder =
    entry.data?.kind === "directory"
      ? path
      : path.split("/").slice(0, -1).join("/");
  const file =
    displayed && displayed.kind !== "directory"
      ? {
          path,
          ...(heading ? { heading } : {}),
          ...(selectedText ? { selection: selectedText } : {}),
          revision: displayedRevision || displayed.revision,
        }
      : undefined;

  useEffect(() => {
    const latest = entry.data;
    if (
      !latest ||
      (chosen?.path === path && chosen.revision === latest.revision)
    )
      return;
    if (chosen?.path === path && latest.kind !== "directory") {
      const element = viewport.current;
      if (element) {
        const anchor = Array.from(
          element.querySelectorAll("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]"),
        )
          .reverse()
          .find(
            (item) =>
              item.getBoundingClientRect().top <=
              element.getBoundingClientRect().top + 8,
          );
        restore.current = {
          path,
          revision: latest.revision,
          top: element.scrollTop,
          ...(anchor
            ? {
                id: anchor.id,
                offset:
                  anchor.getBoundingClientRect().top -
                  element.getBoundingClientRect().top,
              }
            : {}),
        };
      }
      setUpdatedPath(path);
    }
    setChosen(latest);
  }, [entry.data, chosen?.path, chosen?.revision, path]);
  useEffect(() => {
    setUpdatedPath(null);
    restore.current = null;
    jumpedToHeading.current = null;
    const saved = getReadingPosition?.(path);
    tabRestore.current = saved?.heading === heading ? (saved ?? null) : null;
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [path, getReadingPosition]);
  useEffect(() => {
    if (tabRestore.current?.heading !== heading) tabRestore.current = null;
    const target = `${path}#${heading ?? ""}`;
    if (
      !heading ||
      !content.data ||
      content.isPlaceholderData ||
      jumpedToHeading.current === target ||
      restore.current ||
      tabRestore.current
    )
      return;
    viewport.current
      ?.querySelector(`[id="${CSS.escape(heading)}"]`)
      ?.scrollIntoView();
    jumpedToHeading.current = target;
  }, [heading, path, content.data, content.isPlaceholderData]);
  const restoreTabPosition = useCallback(() => {
    const saved = tabRestore.current;
    const element = viewport.current;
    if (
      !saved ||
      !element ||
      !displayed ||
      !previewReady ||
      (textual &&
        (!content.data || content.isPlaceholderData || content.isFetching))
    )
      return;
    // Lazy document images may need the restored scroll position to start loading.
    // Only eager preview images must finish before their dimensions are usable.
    if (
      Array.from(element.querySelectorAll("img")).some(
        (image) => image.loading !== "lazy" && !image.complete,
      )
    )
      return;
    element.scrollTop = saved.top;
    element.scrollLeft = saved.left;
    jumpedToHeading.current = `${path}#${saved.heading ?? ""}`;
    tabRestore.current = null;
  }, [
    displayed,
    previewReady,
    textual,
    content.data,
    content.isPlaceholderData,
    content.isFetching,
    path,
    heading,
  ]);
  useEffect(restoreTabPosition, [restoreTabPosition]);
  useEffect(() => {
    const saved = restore.current;
    const element = viewport.current;
    if (
      !saved ||
      !element ||
      !previewReady ||
      saved.path !== path ||
      displayed?.revision !== saved.revision ||
      (textual && (content.isPlaceholderData || content.isFetching))
    )
      return;
    const anchor = saved.id
      ? element.querySelector(`[id="${CSS.escape(saved.id)}"]`)
      : null;
    element.scrollTop = anchor
      ? element.scrollTop +
        anchor.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        (saved.offset ?? 0)
      : saved.top;
    restore.current = null;
  }, [
    path,
    displayed?.revision,
    previewReady,
    textual,
    content.data,
    content.isFetching,
    content.isPlaceholderData,
  ]);
  useEffect(() => {
    if (!setView) return;
    setView({
      route: workspaceUrl(path),
      title: displayed?.name || "Workspace",
      ...(displayed && displayed.kind !== "directory"
        ? {
            file: {
              path,
              ...(heading ? { heading } : {}),
              ...(selectedText ? { selection: selectedText } : {}),
              revision: displayedRevision || displayed.revision,
            },
          }
        : {}),
    });
    return () => setView(null);
  }, [setView, path, heading, selectedText, displayed, displayedRevision]);
  const open = useCallback(
    (location: WorkspaceLocation) => {
      if (location.path === path && location.heading) {
        tabRestore.current = null;
        viewport.current
          ?.querySelector(`[id="${CSS.escape(location.heading)}"]`)
          ?.scrollIntoView();
      }
      onOpen(location);
    },
    [onOpen, path],
  );
  return (
    <section
      data-slot="workspace-reader"
      className="@container flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {placement === "companion" || displayed?.kind !== "directory" ? (
        <WorkspaceToolbar
          path={path}
          name={displayed?.name || path.split("/").at(-1) || "Workspace"}
          file={Boolean(path && displayed?.kind !== "directory")}
          folder={folder}
          onOpen={open}
          reference={file ? reader?.renderReference?.(file, true) : null}
        />
      ) : null}
      <StrategyBriefAction
        path={path}
        entry={entry.isError ? undefined : entry.data}
        text={content.isError ? undefined : content.data?.text}
        pending={entry.isPending || content.isFetching}
        onOpen={open}
        onStartStrategy={startStrategy}
      />
      {updated ? (
        <div
          role="status"
          data-slot="workspace-file-updated"
          className="flex items-center justify-between gap-3 border-border border-b bg-subtle px-4 py-2 text-xs"
        >
          <span>
            File updated.
            {textual && content.isFetching
              ? " Loading latest content…"
              : textual && content.isError
                ? " Latest content could not be loaded."
                : ""}
          </span>
        </div>
      ) : null}
      {entry.isError ? (
        <div
          role="alert"
          className="flex items-center gap-3 border-border border-b px-4 py-2 text-xs"
        >
          <span>
            {entry.error.message}
            {displayed ? " The last available view is retained." : ""}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void entry.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={viewport}
          data-slot="workspace-reader-scroll"
          className={
            [
              "directory",
              "text",
              "pdf",
              "image",
              "csv",
              "spreadsheet",
              "notebook",
            ].includes(displayed?.kind ?? "")
              ? "min-h-0 min-w-0 flex-1 overflow-auto"
              : "min-h-0 min-w-0 flex-1 overflow-auto p-5"
          }
          onLoadCapture={restoreTabPosition}
          onScroll={() => {
            const saved = restore.current;
            const element = viewport.current;
            if (
              element &&
              displayed &&
              !tabRestore.current &&
              !content.isPlaceholderData
            )
              saveReadingPosition?.(path, {
                top: element.scrollTop,
                left: element.scrollLeft,
                heading,
              });
            if (!saved || !element || !content.isPlaceholderData) return;
            saved.top = element.scrollTop;
            const anchor = saved.id
              ? element.querySelector(`[id="${CSS.escape(saved.id)}"]`)
              : null;
            if (anchor)
              saved.offset =
                anchor.getBoundingClientRect().top -
                element.getBoundingClientRect().top;
          }}
        >
          {entry.isPending ? <p role="status">Opening workspace…</p> : null}
          {displayed?.kind === "directory" ? (
            <WorkspaceDirectory path={path} onOpen={open} />
          ) : displayed ? (
            <WorkspacePreview
              entry={displayed}
              text={content.data?.text}
              onReady={onPreviewReady}
              pending={Boolean(textual && content.isFetching)}
              error={
                textual && content.isError ? content.error.message : undefined
              }
              onOpen={open}
              onRetry={() => {
                void entry.refetch().then((latest) => {
                  if (latest.data) {
                    if (latest.data.revision === displayed.revision)
                      void content.refetch();
                  }
                });
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
