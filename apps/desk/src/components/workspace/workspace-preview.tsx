"use client";

import dynamic from "next/dynamic";
import { RasterPreview } from "./previews/image";
import { CodePreview } from "./previews/code";
const ParsedPreview = dynamic(() => import("./previews/parsed"), {
  ssr: false,
  loading: () => <p role="status">Loading preview…</p>,
});
const PdfPreview = dynamic(() => import("./previews/pdf"), {
  ssr: false,
  loading: () => <p role="status">Loading PDF…</p>,
});

import { Button } from "@pythia/ui";
import { matchRanges } from "@/workspace/search";
import { SearchHighlight } from "./search-highlight";
import { workspaceContentUrl } from "@/workspace/paths";
import type { WorkspaceEntry } from "@/workspace/types";
import type { WorkspaceLocation } from "./reader-context";
import { WorkspaceMarkdown } from "./workspace-markdown";

function contentUrl(entry: WorkspaceEntry) {
  return `${workspaceContentUrl(entry.path)}&revision=${encodeURIComponent(entry.revision)}`;
}
export function WorkspacePreview({
  entry,
  text,
  pending,
  error,
  onOpen,
  onRetry,
  searchTerm,
}: {
  entry: WorkspaceEntry;
  searchTerm?: string | undefined;
  text?: string | undefined;
  pending?: boolean;
  error?: string | undefined;
  onOpen: (location: WorkspaceLocation) => void;
  onRetry?: (() => void) | undefined;
}) {
  if (!entry.previewable)
    return (
      <p
        data-slot="workspace-download-only"
        className="text-body text-foreground-secondary"
      >
        {[
          "text",
          "markdown",
          "csv",
          "spreadsheet",
          "document",
          "notebook",
        ].includes(entry.kind)
          ? "This file is too large to preview here."
          : "No preview available."}
      </p>
    );
  if (entry.kind === "image")
    return (
      <RasterPreview
        key={entry.revision}
        url={contentUrl(entry)}
        name={entry.name}
      />
    );
  if (entry.kind === "pdf")
    return <PdfPreview key={entry.revision} url={contentUrl(entry)} />;
  if (["csv", "spreadsheet", "document", "notebook"].includes(entry.kind))
    return (
      <ParsedPreview
        key={`${entry.path}:${entry.revision}`}
        entry={entry}
        onOpen={onOpen}
      />
    );
  if (entry.kind === "audio")
    return (
      // biome-ignore lint/a11y/useMediaCaption: User-owned media has no supplied captions; the viewer does not generate them.
      <audio
        controls
        preload="metadata"
        src={contentUrl(entry)}
        aria-label={entry.name}
      />
    );
  if (entry.kind === "video")
    return (
      // biome-ignore lint/a11y/useMediaCaption: User-owned media has no supplied captions; the viewer does not generate them.
      <video
        controls
        preload="metadata"
        src={contentUrl(entry)}
        aria-label={entry.name}
        className="max-w-full"
      />
    );
  return (
    <div data-slot="workspace-text-preview">
      {pending && text === undefined ? (
        <p role="status" className="text-foreground-secondary text-xs">
          Loading file…
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          {onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry reading file
            </Button>
          ) : null}
        </div>
      ) : null}
      {text !== undefined ? (
        entry.kind === "markdown" ? (
          <WorkspaceMarkdown
            text={text}
            path={entry.path}
            onOpen={onOpen}
            searchTerm={searchTerm}
          />
        ) : searchTerm ? (
          <pre className="overflow-auto whitespace-pre-wrap text-sm">
            <SearchHighlight
              text={text.slice(0, 100_000)}
              ranges={matchRanges(text.slice(0, 100_000), [searchTerm])}
            />
          </pre>
        ) : (
          <CodePreview text={text} name={entry.name} />
        )
      ) : null}
    </div>
  );
}
