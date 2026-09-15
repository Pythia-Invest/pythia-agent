"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@pythia/ui";
import { WorkspaceCompanion } from "./workspace-companion";
import { WorkspaceNavigation } from "./workspace-navigation";
import { Search } from "lucide-react";
import { useWorkspaceEntry, useWorkspaceSearch } from "@/client/queries";
import { WorkspaceSearchResults } from "./workspace-search-results";
import { resolveWorkspaceLink, workspaceUrl } from "@/workspace/paths";
import { type WorkspaceLocation, useWorkspaceReader } from "./reader-context";
import { WorkspaceDirectory } from "./workspace-browser";

export function WorkspacePage() {
  const pathname = usePathname();
  const location = resolveWorkspaceLink(pathname.slice("/workspace".length));
  const path = location?.path ?? "";
  const reader = useWorkspaceReader();
  const openReader = reader?.open;
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft("");
    setTerm("");
    setSearchScope("workspace");
  }, [pathname]);
  const [term, setTerm] = useState("");
  const entry = useWorkspaceEntry(path);
  const folder =
    entry.data?.kind === "directory"
      ? path
      : path.split("/").slice(0, -1).join("/");
  const [searchScope, setSearchScope] = useState<"workspace" | "folder">(
    "workspace",
  );
  const search = useWorkspaceSearch(
    searchScope === "folder" ? folder : "",
    term,
  );
  useEffect(() => {
    const timer = setTimeout(() => setTerm(draft.trim()), 200);
    return () => clearTimeout(timer);
  }, [draft]);
  const [heading, setHeading] = useState<string>();
  useEffect(() => {
    const update = () => {
      try {
        setHeading(
          decodeURIComponent(window.location.hash.slice(1)) || undefined,
        );
      } catch {
        setHeading(undefined);
      }
    };
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, [pathname]);
  useEffect(() => {
    if (!entry.data) return;
    if (entry.data.kind !== "directory") openReader?.({ path, heading });
  }, [entry.data?.kind, path, heading, openReader]);
  const open = useCallback(
    (next: WorkspaceLocation) => {
      setHeading(next.heading);
      const href = workspaceUrl(next.path, next.heading);
      if (href !== window.location.pathname + window.location.hash)
        window.history.pushState(null, "", href);
      else if (entry.data?.kind !== "directory") openReader?.(next);
    },
    [entry.data?.kind, openReader],
  );
  if (!location)
    return (
      <p role="alert" className="p-4 text-body">
        This workspace path is invalid.
      </p>
    );

  const content = term ? (
    <section
      aria-label="Search results"
      className="min-h-0 flex-1 overflow-auto"
    >
      {search.isError ? (
        <div role="alert">
          Search unavailable.{" "}
          <Button variant="ghost" onClick={() => void search.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {search.data || search.isPending ? (
        <WorkspaceSearchResults
          data={search.data ?? { matches: [], partial: false, scanned: 0 }}
          pending={search.isFetching}
          query={term}
          folder={folder}
          scope={searchScope}
          onScopeChange={setSearchScope}
          onOpen={open}
          onOpenFile={openReader}
        />
      ) : null}
    </section>
  ) : (
    <div className="@container min-h-0 flex-1 overflow-auto">
      {entry.isPending ? (
        <p role="status" className="p-3 text-body">
          Opening workspace…
        </p>
      ) : entry.isError ? (
        <div role="alert" className="p-3 text-body">
          Could not open this workspace path.{" "}
          <Button variant="ghost" onClick={() => void entry.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <WorkspaceDirectory
          path={folder}
          onOpen={open}
          onOpenFile={openReader}
        />
      )}
    </div>
  );
  return (
    <WorkspaceCompanion>
      <div
        data-slot="workspace-page"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div
          data-slot="workspace-browser-toolbar"
          className="flex shrink-0 items-center gap-3 border-border border-b p-2 max-[599px]:flex-wrap"
        >
          <WorkspaceNavigation />
          <div className="relative w-52 max-w-[35%] shrink-0 max-[599px]:w-full max-[599px]:max-w-none">
            <Search
              aria-hidden="true"
              className="absolute top-2.5 left-2.5 size-3.5 text-foreground-secondary"
            />
            <Input
              type="search"
              aria-label="Search files and folders"
              placeholder="Search files and folders"
              maxLength={200}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-8 bg-raised pl-8 text-body"
            />
          </div>
        </div>
        {content}
      </div>
    </WorkspaceCompanion>
  );
}
