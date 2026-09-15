"use client";

import { Button, IconButton, cn } from "@pythia/ui";
import { ChevronRight, Pin, PinOff } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { useWorkspaceList } from "@/client/queries";
import { resolveWorkspaceLink } from "@/workspace/paths";
import type { WorkspaceLocation } from "./reader-context";
import { WorkspaceFileIcon } from "./workspace-file-icon";

const PIN_KEY = "pythia.workspace.pinned-folders";
type TreeProps = {
  current: string;
  onOpen: (location: WorkspaceLocation) => void;
};
type TreeState = TreeProps & {
  expandedPaths: ReadonlySet<string>;
  onToggle: (path: string) => void;
  pins: string[];
  onPin: (path: string) => void;
};
function FolderRow({
  path,
  name,
  pinned = false,
  ...state
}: TreeState & { path: string; name: string; pinned?: boolean }) {
  const expanded = state.expandedPaths.has(path);
  const isPinned = state.pins.includes(path);
  return (
    <li data-tree-row="folder">
      <div
        className={cn(
          "group flex h-7 min-w-0 items-center rounded-control hover:bg-interaction-hover",
          state.current === path && "bg-interaction-active",
        )}
      >
        {!pinned ? (
          <button
            type="button"
            data-expand
            aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
            aria-expanded={expanded}
            onClick={() => state.onToggle(path)}
            className="motion-fast flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-control text-foreground-secondary outline-ring transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 active:bg-foreground/20 active:text-foreground"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn("size-3.5", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          data-folder-name
          title={path}
          onClick={() => state.onOpen({ path })}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-control text-left text-body outline-ring focus-visible:outline-2"
        >
          <WorkspaceFileIcon
            entry={{ name, kind: "directory" }}
            expanded={!pinned && expanded}
          />
          <span className="truncate">{name}</span>
        </button>
        <IconButton
          label={`${isPinned ? "Unpin" : "Pin"} ${name}`}
          size="sm"
          onClick={() => state.onPin(path)}
          className={cn(
            "size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 max-[899px]:opacity-100",
            pinned && "opacity-100",
          )}
        >
          {isPinned ? (
            <PinOff className="size-3" />
          ) : (
            <Pin className="size-3" />
          )}
        </IconButton>
      </div>
      {!pinned && expanded ? (
        <div className="ml-3">
          <FolderContents path={path} {...state} />
        </div>
      ) : null}
    </li>
  );
}
function FolderContents({ path, ...state }: TreeState & { path: string }) {
  const listing = useWorkspaceList(path);
  const folders = listing.data?.entries.filter(
    (entry) => entry.kind === "directory",
  );
  return (
    <ul className="m-0 list-none p-0">
      {listing.isPending ? (
        <li role="status" className="p-2 text-foreground-secondary text-xs">
          Loading…
        </li>
      ) : null}
      {listing.isError ? (
        <li>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void listing.refetch()}
          >
            Retry folder
          </Button>
        </li>
      ) : null}
      {folders?.map((entry) => (
        <FolderRow
          key={entry.path}
          path={entry.path}
          name={entry.name}
          {...state}
        />
      ))}
      {folders?.length === 0 ? (
        <li className="py-1 pl-5 text-foreground-secondary text-xs">
          No subfolders
        </li>
      ) : null}
      {listing.data?.partial ? (
        <li role="status" className="p-2 text-foreground-secondary text-xs">
          Some folders could not be listed.
        </li>
      ) : null}
    </ul>
  );
}
function ancestors(path: string) {
  return path
    .split("/")
    .map((_, index, parts) => parts.slice(0, index).join("/"));
}
function navigateTree(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (!target.hasAttribute("data-folder-name")) return;
  const row = target.closest<HTMLElement>("[data-tree-row]");
  if (!row) return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-folder-name]"),
  );
  const index = rows.indexOf(target);
  const expand = row.querySelector<HTMLElement>(":scope > div > [data-expand]");
  let next: HTMLElement | null | undefined;
  if (event.key === "ArrowDown") next = rows[index + 1];
  else if (event.key === "ArrowUp") next = rows[index - 1];
  else if (event.key === "Home") next = rows[0];
  else if (event.key === "End") next = rows.at(-1);
  else if (event.key === "ArrowRight") {
    if (expand?.getAttribute("aria-expanded") === "false") expand.click();
    else
      next = row.querySelector<HTMLElement>(
        ":scope > div > ul [data-folder-name]",
      );
  } else if (event.key === "ArrowLeft") {
    if (expand?.getAttribute("aria-expanded") === "true") expand.click();
    else
      next = row.parentElement
        ?.closest("[data-tree-row]")
        ?.querySelector<HTMLElement>("[data-folder-name]");
  } else return;
  event.preventDefault();
  next?.focus();
}
export function WorkspaceTree({ current, onOpen }: TreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(
    () => new Set(ancestors(current)),
  );
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]");
      if (Array.isArray(value))
        setPins(
          [
            ...new Set(
              value.filter(
                (path): path is string =>
                  typeof path === "string" &&
                  !!path &&
                  resolveWorkspaceLink(path)?.path === path,
              ),
            ),
          ].slice(0, 100),
        );
    } catch {
      /* An unavailable preference store does not block browsing. */
    }
  }, []);
  useEffect(() => {
    setExpandedPaths(
      (previous) => new Set([...previous, ...ancestors(current)]),
    );
  }, [current]);
  const state: TreeState = {
    current,
    onOpen,
    pins,
    expandedPaths,
    onToggle: (path) =>
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    onPin: (path) =>
      setPins((previous) => {
        const next = previous.includes(path)
          ? previous.filter((pin) => pin !== path)
          : [...previous, path].slice(0, 100);
        try {
          localStorage.setItem(PIN_KEY, JSON.stringify(next));
        } catch {
          /* Keep this view usable. */
        }
        return next;
      }),
  };
  return (
    <nav
      aria-label="Folder tree"
      data-slot="workspace-tree"
      onKeyDown={navigateTree}
    >
      {pins.length ? (
        <section aria-label="Pinned folders" className="mb-3">
          <h2 className="px-2 py-2 font-medium text-foreground-secondary text-xs">
            Pinned
          </h2>
          <ul className="m-0 list-none p-0">
            {pins.map((path) => (
              <FolderRow
                key={path}
                path={path}
                name={path.split("/").at(-1) ?? path}
                pinned
                {...state}
              />
            ))}
          </ul>
        </section>
      ) : null}
      <FolderContents path="" {...state} />
    </nav>
  );
}
