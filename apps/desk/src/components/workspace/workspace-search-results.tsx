"use client";
import { Button } from "@pythia/ui";
import type { WorkspaceSearch } from "@/workspace/types";
import { filenameSearch } from "@/workspace/filename-search";
import type { WorkspaceLocation } from "./reader-context";
import { WorkspaceFileIcon } from "./workspace-file-icon";
import { WorkspaceLink } from "./workspace-link";
import { SearchHighlight } from "./search-highlight";

export function WorkspaceSearchResults({
  data,
  query,
  folder,
  scope = "workspace",
  onScopeChange,
  onOpen,
  onOpenFile,
  pending = false,
}: {
  pending?: boolean;
  data: WorkspaceSearch;
  query: string;
  folder: string;
  scope?: "workspace" | "folder";
  onScopeChange?: (scope: "workspace" | "folder") => void;
  onOpen: (location: WorkspaceLocation) => void;
  onOpenFile: ((location: WorkspaceLocation) => void) | undefined;
}) {
  const matcher = filenameSearch(query);
  const matches = data.matches;
  return (
    <div
      data-slot="workspace-search-results"
      aria-busy={pending}
      className="min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-border border-b px-3 py-2 text-xs">
        <fieldset
          aria-label="Search location"
          className="flex min-w-0 items-center gap-1"
        >
          <span className="mr-1 text-foreground-secondary">Search:</span>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={scope === "workspace"}
            onClick={() => onScopeChange?.("workspace")}
            className="h-7 px-2 text-xs aria-pressed:bg-interaction-active"
          >
            Workspace
          </Button>
          {folder ? (
            <Button
              size="sm"
              variant="ghost"
              title={folder}
              aria-label={`Search in ${folder}`}
              aria-pressed={scope === "folder"}
              onClick={() => onScopeChange?.("folder")}
              className="h-7 min-w-0 max-w-40 px-2 text-xs aria-pressed:bg-interaction-active"
            >
              <span className="truncate">“{folder.split("/").at(-1)}”</span>
            </Button>
          ) : null}
        </fieldset>
      </div>
      <p role="status" className="px-3 py-1 text-foreground-secondary text-xs">
        {pending
          ? "Searching…"
          : `${matches.length} ${matches.length === 1 ? "result" : "results"}`}
      </p>
      <ul className="m-0 list-none p-0">
        {matches.map((match) => {
          const { entry } = match;
          const parent = entry.path.split("/").slice(0, -1).join("/");
          const location = { path: entry.path };
          const open = entry.kind === "directory" ? onOpen : onOpenFile;
          return (
            <li
              key={entry.path}
              className="group min-w-0 border-border border-b px-3 py-2 text-body hover:bg-interaction-hover"
            >
              <div className="flex min-w-0 items-center gap-2">
                <WorkspaceFileIcon entry={entry} className="size-4 shrink-0" />
                <div
                  className="min-w-0 flex-1 truncate [&_a]:rounded-control [&_a]:outline-ring [&_a]:focus-visible:outline-2"
                  title={entry.name}
                >
                  <WorkspaceLink location={location} onOpen={open}>
                    <SearchHighlight
                      text={entry.name}
                      ranges={match.nameRanges ?? matcher.ranges(entry.name)}
                    />
                  </WorkspaceLink>
                </div>
              </div>
              <p
                title={parent || "Workspace"}
                className="mt-0.5 ml-6 truncate text-foreground-secondary text-xs"
              >
                <SearchHighlight
                  text={parent || "Workspace"}
                  ranges={match.pathRanges ?? matcher.ranges(parent)}
                />
              </p>
            </li>
          );
        })}
      </ul>
      {!pending && !matches.length ? (
        <p role="status" className="p-3 text-foreground-secondary text-xs">
          No matching files or folders found
          {data.partial ? " in the files searched" : ""}.
        </p>
      ) : null}
      {data.partial ? (
        <details className="px-3 py-2 text-foreground-secondary text-xs">
          <summary className="cursor-pointer rounded-control outline-ring focus-visible:outline-2">
            Some files weren’t searched or shown
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {(
              data.issues ??
              (data.partial ? ["Some files could not be searched."] : [])
            ).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
