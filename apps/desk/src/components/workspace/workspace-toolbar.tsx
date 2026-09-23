"use client";

import { WidgetToolbarOutlet } from "@pythia/widget-sdk";
import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { workspaceContentUrl } from "@/workspace/paths";
import { WorkspaceFolderPath } from "./workspace-folder-path";
import type { WorkspaceLocation } from "./reader-context";

const actionClassName =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-control text-foreground-secondary outline-ring hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2";

/** Tabs identify and close files; this row owns location and file actions only. */
export function WorkspaceToolbar({
  path,
  name,
  file,
  folder,
  onOpen,
  reference,
}: {
  path: string;
  name: string;
  file: boolean;
  folder: string;
  onOpen: (location: WorkspaceLocation) => void;
  reference: ReactNode;
}) {
  return (
    <header
      data-slot="workspace-toolbar"
      className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-border border-b px-3"
    >
      <h1 className="sr-only">{name}</h1>
      <div className="min-w-0 flex-1">
        <WorkspaceFolderPath
          folder={folder}
          currentFile={path}
          onOpen={onOpen}
        />
      </div>
      <WidgetToolbarOutlet />
      {reference}
      {file ? (
        <a
          className={actionClassName}
          href={workspaceContentUrl(path, true)}
          download
          aria-label="Download"
          title="Download"
        >
          <Download aria-hidden="true" className="size-4" />
        </a>
      ) : null}
    </header>
  );
}
