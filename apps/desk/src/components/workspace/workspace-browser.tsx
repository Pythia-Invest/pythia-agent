"use client";

import { Button, cn } from "@pythia/ui";
import { useState } from "react";
import { usePrefetchWorkspaceEntry, useWorkspaceList } from "@/client/queries";
import type { WorkspaceEntry } from "@/workspace/types";
import type { WorkspaceLocation } from "./reader-context";
import { WorkspaceLink } from "./workspace-link";
import { WorkspaceFileIcon } from "./workspace-file-icon";

function fileType(entry: WorkspaceEntry) {
  return entry.kind === "directory"
    ? "Folder"
    : entry.name.split(".").length > 1
      ? `${entry.name.split(".").at(-1)?.toUpperCase()} file`
      : "File";
}
function fileSize(entry: WorkspaceEntry) {
  if (entry.kind === "directory") return "";
  return entry.size < 1024
    ? `${entry.size} B`
    : entry.size < 1024 * 1024
      ? `${Math.ceil(entry.size / 1024)} KB`
      : `${(entry.size / (1024 * 1024)).toFixed(1)} MB`;
}
export function WorkspaceDirectory({
  path,
  onOpen,
  onOpenFile,
}: {
  path: string;
  onOpen: (location: WorkspaceLocation) => void;
  onOpenFile?: ((location: WorkspaceLocation) => void) | undefined;
}) {
  const [selected, setSelected] = useState<string>();
  const listing = useWorkspaceList(path);
  const prefetch = usePrefetchWorkspaceEntry();
  return (
    <section
      data-slot="workspace-directory"
      aria-label="Folder contents"
      className="min-w-0"
    >
      <h2 className="sr-only">{path.split("/").at(-1) || "Workspace"}</h2>
      {listing.isPending ? (
        <p role="status" className="p-3 text-foreground-secondary text-xs">
          Loading files…
        </p>
      ) : null}
      {listing.isError ? (
        <div role="alert" className="p-3 text-xs">
          <p>Could not load this folder.</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void listing.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {listing.data ? (
        <div data-slot="workspace-file-list">
          <div className="grid @lg:grid-cols-[minmax(0,1fr)_7rem_5rem] grid-cols-[minmax(0,1fr)_5rem] gap-3 border-border border-b px-3 py-2 text-foreground-secondary text-xs">
            <span>Name</span>
            <span className="@lg:block hidden">Type</span>
            <span className="text-right">Size</span>
          </div>
          <ul className="m-0 list-none p-1">
            {listing.data.entries.map((entry) => (
              <li
                key={entry.path}
                className={cn(
                  "rounded-control text-body hover:bg-interaction-hover [&_a]:grid @lg:[&_a]:grid-cols-[minmax(0,1fr)_7rem_5rem] [&_a]:grid-cols-[minmax(0,1fr)_5rem] [&_a]:items-center [&_a]:gap-3 [&_a]:rounded-control [&_a]:px-2 [&_a]:py-1.5 [&_a]:outline-ring [&_a]:focus-visible:outline-2",
                  selected === entry.path && "bg-interaction-active",
                )}
              >
                <WorkspaceLink
                  location={{ path: entry.path }}
                  onOpen={(location) => {
                    setSelected(entry.path);
                    (entry.kind === "directory"
                      ? onOpen
                      : (onOpenFile ?? onOpen))(location);
                  }}
                  onIntent={() => prefetch(entry.path)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <WorkspaceFileIcon entry={entry} />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="@lg:block hidden truncate text-foreground-secondary text-xs"
                  >
                    {fileType(entry)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-right text-foreground-secondary text-xs tabular-nums"
                  >
                    {fileSize(entry)}
                  </span>
                </WorkspaceLink>
              </li>
            ))}
          </ul>
          {!listing.data.entries.length ? (
            <p role="status" className="p-3 text-foreground-secondary text-xs">
              This folder is empty.
            </p>
          ) : null}
          {listing.data.partial ? (
            <p role="status" className="p-3 text-foreground-secondary text-xs">
              Some files could not be listed.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
