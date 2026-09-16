import { filenameSearch } from "@/workspace/filename-search";
import { opendir } from "node:fs/promises";
import type { WorkspaceListing, WorkspaceSearch } from "@/workspace/types";
import {
  describe,
  describeBytes,
  EXCLUDED,
  failure,
  fileBoundary,
  revision,
} from "./files";
import { fileResponse } from "./response";

export function createWorkspaceStore(
  workspace: () => string | undefined = () => process.env.PYTHIA_WORKSPACE,
) {
  const boundary = fileBoundary(workspace);
  async function entry(path: string) {
    const found = await boundary.inspect(path);
    if (found.stat.isDirectory()) return describe(path, found.stat);
    const file = await boundary.file(path);
    try {
      const value = await describe(path, file.stat, file.handle);
      await file.check();
      return value;
    } finally {
      await file.handle.close();
    }
  }
  async function metadata(path: string) {
    const found = await boundary.inspect(path);
    return describeBytes(path, found.stat);
  }
  async function list(
    path: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceListing> {
    signal?.throwIfAborted();
    const found = await boundary.inspect(path);
    if (!found.stat.isDirectory())
      throw failure("workspace_type", "Choose a directory.", 415);
    const entries = [];
    let scanned = 0;
    let partial = false;
    const dir = await opendir(found.target);
    for await (const child of dir) {
      signal?.throwIfAborted();
      if (++scanned > 1000) {
        partial = true;
        break;
      }
      if (
        EXCLUDED.has(child.name) ||
        child.isSymbolicLink() ||
        (!child.isFile() && !child.isDirectory())
      )
        continue;
      try {
        entries.push(
          await metadata(path ? `${path}/${child.name}` : child.name),
        );
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && error.name === "AbortError") throw error;
        partial = true;
      }
    }
    if (revision((await boundary.inspect(path)).stat) !== revision(found.stat))
      throw failure(
        "workspace_changed",
        "The directory changed. Refresh it.",
        409,
      );
    entries.sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
    return { entries, partial, scanned };
  }
  async function search(
    path: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceSearch> {
    if (!query.trim() || query.length > 200)
      throw failure("workspace_query", "Enter a search of 1–200 characters.");
    const matcher = filenameSearch(query);
    if (matcher.empty) throw failure("workspace_query", "Enter a search term.");
    type Candidate = {
      path: string;
      name: string;
      score: number;
    };
    const candidates: Candidate[] = [];
    const queue = [path];
    const issues = new Set<string>();
    let scanned = 0;
    // Directory entries supply names. Do not open file bodies to discover names.
    // Every directory and every retained/read file still crosses fileBoundary.
    for (let index = 0; index < queue.length; index++) {
      signal?.throwIfAborted();
      if (scanned >= 50_000) {
        issues.add("The folder scan reached its limit.");
        break;
      }
      const directory = queue[index];
      if (directory === undefined) break;
      const start = candidates.length,
        queued = queue.length;
      try {
        const found = await boundary.inspect(directory);
        if (!found.stat.isDirectory())
          throw failure("workspace_type", "Choose a directory.", 415);
        const dir = await opendir(found.target);
        for await (const child of dir) {
          signal?.throwIfAborted();
          if (scanned >= 50_000) {
            issues.add("The folder scan reached its limit.");
            break;
          }
          scanned++;
          if (
            EXCLUDED.has(child.name) ||
            child.isSymbolicLink() ||
            (!child.isFile() && !child.isDirectory())
          )
            continue;
          const childPath = directory
            ? `${directory}/${child.name}`
            : child.name;
          const score = matcher.score(childPath, child.name);
          if (score > 0)
            candidates.push({ path: childPath, name: child.name, score });
          if (child.isDirectory()) queue.push(childPath);
        }
        if (
          revision((await boundary.inspect(directory)).stat) !==
          revision(found.stat)
        )
          throw failure(
            "workspace_changed",
            "The directory changed during search.",
            409,
          );
      } catch (error) {
        signal?.throwIfAborted();
        if (
          directory === path ||
          (error instanceof Error && error.name === "AbortError")
        )
          throw error;
        candidates.length = start;
        queue.length = queued;
        issues.add("Some folders could not be read.");
      }
    }
    const ranked = candidates.sort(
      (a, b) =>
        b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
    const results = new Map<string, WorkspaceSearch["matches"][number]>();
    const nameCandidates = ranked;
    for (const item of nameCandidates.slice(0, 100)) {
      signal?.throwIfAborted();
      try {
        // Search needs metadata only. The reader checks bytes when opened;
        // name matching never needs to open file bodies.
        const value = await metadata(item.path);
        results.set(item.path, {
          entry: value,
          match: item.score >= 500 ? "name" : "path",
          nameRanges: matcher.ranges(item.name),
          pathRanges: matcher.ranges(
            item.path.split("/").slice(0, -1).join("/"),
          ),
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && error.name === "AbortError") throw error;
        issues.add("Some files changed or could not be read.");
      }
    }
    const matchedFiles = nameCandidates.length;
    if (matchedFiles > 100) issues.add("Showing the first 100 ranked results.");
    return {
      matches: [...results.values()],
      total: matchedFiles,
      partial: issues.size > 0,
      issues: [...issues],
      scanned,
    };
  }

  return {
    entry,
    list,
    search,
    resolveHostPath: boundary.hostPath,
    async reference(path: string) {
      const found = await boundary.inspect(path);
      return { ...(await entry(path)), hostPath: found.target };
    },
    async response(path: string, request: Request) {
      return fileResponse(boundary, path, request);
    },
  };
}
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
export const workspaceStore = createWorkspaceStore();
