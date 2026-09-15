"use client";

import { Menu } from "@pythia/ui";
import { ChevronRight } from "lucide-react";
import { createContext, useContext, useId, useState } from "react";
import { useWorkspaceList } from "@/client/queries";
import { WorkspaceFileIcon } from "./workspace-file-icon";
import type { WorkspaceLocation } from "./reader-context";

type FolderProps = {
  path: string;
  currentFile: string;
  onOpen: (location: WorkspaceLocation) => void;
};
const folderControlClassName =
  "flex h-6 shrink-0 items-center gap-1 rounded-control px-1 text-foreground-secondary text-xs outline-ring hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 data-popup-open:bg-interaction-hover";
const popupClassName = "max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto";
const SubmenuDirection = createContext<"left" | "right">("right");

/** Mounted only while its menu is open: browse one level, never crawl a tree. */
function FolderContents({ path, currentFile, onOpen }: FolderProps) {
  const listing = useWorkspaceList(path);
  if (listing.isPending)
    return (
      <p role="status" className="px-3 py-2 text-foreground-secondary text-xs">
        Loading files…
      </p>
    );
  if (listing.isError)
    return (
      <>
        <p role="alert" className="px-3 py-2 text-error text-xs">
          Could not load this folder.
        </p>
        <Menu.Item closeOnClick={false} onClick={() => void listing.refetch()}>
          Retry
        </Menu.Item>
      </>
    );
  return (
    <>
      {listing.data.entries.map((entry) =>
        entry.kind === "directory" ? (
          <FolderSubmenu
            key={entry.path}
            path={entry.path}
            name={entry.name}
            currentFile={currentFile}
            onOpen={onOpen}
          />
        ) : (
          <Menu.Item
            key={entry.path}
            label={entry.name}
            aria-current={entry.path === currentFile ? "page" : undefined}
            onClick={() => onOpen({ path: entry.path })}
          >
            <WorkspaceFileIcon entry={entry} />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          </Menu.Item>
        ),
      )}
      {!listing.data.entries.length ? (
        <p
          role="status"
          className="px-3 py-2 text-foreground-secondary text-xs"
        >
          This folder is empty.
        </p>
      ) : null}
      {listing.data.partial ? (
        <p
          role="status"
          className="px-3 py-2 text-foreground-secondary text-xs"
        >
          Some files could not be listed.
        </p>
      ) : null}
    </>
  );
}

function FolderSubmenu({ name, ...props }: FolderProps & { name: string }) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const side = useContext(SubmenuDirection);
  return (
    <Menu.SubmenuRoot open={open} onOpenChange={setOpen}>
      <Menu.SubmenuTrigger label={name} aria-label={name} openOnHover={false}>
        <WorkspaceFileIcon
          entry={{ name, kind: "directory" }}
          expanded={open}
        />
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner
          side={side}
          align="start"
          render={(elementProps, state) => (
            <div {...elementProps}>
              <SubmenuDirection.Provider
                value={state.side === "left" ? "left" : "right"}
              >
                {elementProps.children}
              </SubmenuDirection.Provider>
            </div>
          )}
        >
          <Menu.Popup
            className={popupClassName}
            aria-labelledby={labelId}
            aria-label={`Files in ${props.path}`}
          >
            <span id={labelId} className="sr-only">
              Files in {props.path || "Workspace"}
            </span>
            {open ? <FolderContents {...props} /> : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

function FolderMenu({ name, ...props }: FolderProps & { name: string }) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger
        openOnHover={false}
        className={folderControlClassName}
        title={props.path || "Workspace"}
      >
        <span className="max-w-48 truncate">{name}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup
            className={popupClassName}
            aria-labelledby={labelId}
            aria-label={`Files in ${props.path || "Workspace"}`}
          >
            <span id={labelId} className="sr-only">
              Files in {props.path || "Workspace"}
            </span>
            {open ? <FolderContents {...props} /> : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function WorkspaceFolderPath({
  folder,
  currentFile,
  onOpen,
  onNavigate,
}: {
  folder: string;
  currentFile: string;
} & (
  | { onOpen: (location: WorkspaceLocation) => void; onNavigate?: never }
  | { onNavigate: (path: string) => void; onOpen?: never }
)) {
  const parts = folder.split("/").filter(Boolean);
  const folders = [
    { path: "", name: "Workspace" },
    ...parts.map((name, index) => ({
      name,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];
  return (
    <nav
      key={currentFile}
      data-slot="workspace-folder-path"
      aria-label="Workspace folders"
      className="flex min-w-0 items-center overflow-x-auto"
    >
      {folders.map((item, index) => (
        <div key={item.path} className="flex shrink-0 items-center">
          {index ? (
            <ChevronRight
              aria-hidden="true"
              className="size-3 text-foreground-disabled"
            />
          ) : null}
          {onNavigate ? (
            <button
              type="button"
              className={folderControlClassName}
              title={item.path || "Workspace"}
              aria-current={item.path === folder ? "page" : undefined}
              onClick={() => onNavigate(item.path)}
            >
              <span className="max-w-48 truncate">{item.name}</span>
            </button>
          ) : (
            <FolderMenu {...item} currentFile={currentFile} onOpen={onOpen} />
          )}
        </div>
      ))}
    </nav>
  );
}
