"use client";

import { IconButton } from "@pythia/ui";
import { ArrowLeft, ArrowRight, ArrowUp, House } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceEntry } from "@/client/queries";
import { resolveWorkspaceLink, workspaceUrl } from "@/workspace/paths";
import { WorkspaceFolderPath } from "./workspace-folder-path";

export function WorkspaceNavigation() {
  const pathname = usePathname();
  const path =
    resolveWorkspaceLink(pathname.slice("/workspace".length))?.path ?? "";
  const entry = useWorkspaceEntry(path);
  const folder =
    entry.data?.kind === "directory"
      ? path
      : path.split("/").slice(0, -1).join("/");
  const router = useRouter();
  return (
    <div
      data-slot="workspace-navigation"
      className="flex min-w-0 flex-1 items-center gap-1 max-[599px]:basis-full"
    >
      <IconButton
        label="Workspace home"
        size="sm"
        disabled={!folder || entry.isPending}
        onClick={() => window.history.pushState(null, "", workspaceUrl(""))}
      >
        <House />
      </IconButton>
      <IconButton label="Back" size="sm" onClick={() => router.back()}>
        <ArrowLeft />
      </IconButton>
      <IconButton label="Forward" size="sm" onClick={() => router.forward()}>
        <ArrowRight />
      </IconButton>
      <IconButton
        label="Up one folder"
        size="sm"
        disabled={!folder || entry.isPending}
        onClick={() =>
          window.history.pushState(
            null,
            "",
            workspaceUrl(folder.split("/").slice(0, -1).join("/")),
          )
        }
      >
        <ArrowUp />
      </IconButton>
      <div className="ml-1 min-w-0 flex-1 overflow-x-auto rounded-control border border-border bg-raised px-2 py-1">
        <WorkspaceFolderPath
          folder={folder}
          currentFile={path}
          onNavigate={(folder) =>
            window.history.pushState(null, "", workspaceUrl(folder))
          }
        />
      </div>
    </div>
  );
}
