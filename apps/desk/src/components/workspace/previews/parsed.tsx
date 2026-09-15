"use client";
import { Button } from "@pythia/ui";
import { useState } from "react";
import { useParsedPreview } from "@/client/workspace-preview-query";
import type { WorkspaceEntry } from "@/workspace/types";
import type { WorkspaceLocation } from "../reader-context";
import { WorkspaceMarkdown } from "../workspace-markdown";
import { TablePreview } from "./table";
import { CodePreview } from "./code";
import { DocumentPreview } from "./document";
import { PreviewToolbar } from "./toolbar";

export default function ParsedPreview({
  entry,
  onOpen,
}: {
  entry: WorkspaceEntry;
  onOpen: (location: WorkspaceLocation) => void;
}) {
  const [sheet, setSheet] = useState(0);
  const preview = useParsedPreview(entry, sheet);
  if (preview.isPending)
    return (
      <p role="status" className="text-foreground-secondary text-xs">
        Loading preview…
      </p>
    );
  if (preview.isError)
    return (
      <div role="status">
        <p>{preview.error.message}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void preview.refetch()}
        >
          Retry preview
        </Button>
      </div>
    );
  const result = preview.data;
  if (result.kind === "table")
    return (
      <>
        <TablePreview key={sheet} table={result.table} onSheet={setSheet} />
        {entry.kind === "spreadsheet" ? (
          <p className="px-3 py-2 text-foreground-secondary text-xs">
            Saved values · formulas are not recalculated
          </p>
        ) : null}
      </>
    );
  if (result.kind === "document") return <DocumentPreview html={result.html} />;
  return (
    <div data-slot="workspace-notebook" className="min-w-0">
      <PreviewToolbar label="Notebook information">
        <span className="text-foreground-secondary">
          {result.language} · {result.cells.length} cells
        </span>
        <span
          className="ml-auto text-foreground-secondary"
          title="Saved outputs are shown as stored in the notebook; cells are not executed."
        >
          Saved outputs
        </span>
      </PreviewToolbar>
      <div className="space-y-3 px-3 py-4">
        {result.cells.map((cell, index) => (
          <section
            key={index}
            aria-label={`Cell ${index + 1}`}
            className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1"
          >
            {cell.kind === "markdown" ? (
              <div className="col-start-2 py-2">
                <WorkspaceMarkdown
                  text={cell.source}
                  path={entry.path}
                  onOpen={onOpen}
                />
              </div>
            ) : (
              <>
                <span
                  data-slot="workspace-notebook-prompt"
                  className="overflow-hidden pt-1 text-right font-mono text-foreground-secondary text-xs leading-6"
                  title={
                    cell.executionCount === undefined
                      ? "No saved execution count"
                      : `Saved execution ${cell.executionCount}`
                  }
                >
                  {cell.kind === "code"
                    ? `[${cell.executionCount ?? " "}]:`
                    : ""}
                </span>
                <div className="min-w-0 overflow-hidden rounded-control border border-border bg-subtle">
                  <CodePreview
                    embedded
                    text={cell.source}
                    language={cell.kind === "code" ? result.language : "text"}
                  />
                </div>
              </>
            )}
            {cell.output || cell.image ? (
              <>
                <span
                  aria-hidden="true"
                  className="pt-1 text-right font-mono text-foreground-secondary text-xs leading-6"
                >
                  {cell.outputCount !== undefined
                    ? `[${cell.outputCount}]:`
                    : ""}
                </span>
                <section
                  data-slot="workspace-notebook-output"
                  aria-label="Saved output"
                  className="min-w-0 px-2 py-1"
                >
                  {cell.output ? (
                    <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-6">
                      {cell.output}
                    </pre>
                  ) : null}
                  {cell.image ? (
                    <img
                      src={cell.image}
                      alt={`Saved output of cell ${index + 1}`}
                      loading="lazy"
                      className="max-w-full"
                    />
                  ) : null}
                </section>
              </>
            ) : null}
          </section>
        ))}
      </div>
      {result.limited ? (
        <p className="px-4 pb-4 text-foreground-secondary text-xs">
          Showing a limited notebook preview. Download the original for all
          cells and outputs.
        </p>
      ) : null}
    </div>
  );
}
