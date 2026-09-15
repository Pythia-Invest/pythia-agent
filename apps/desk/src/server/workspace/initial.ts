import { dehydrate, QueryClient } from "@tanstack/react-query";
import { workspaceKeys } from "@/workspace/query-keys";
import { admitBrowserRequest } from "../admission";
import { workspaceStore, type WorkspaceStore } from "./store";

/** Request-local snapshot only. Failed reads fall back to the existing admitted
 * client query, which owns error display and retry. Never cache across requests. */
export async function initialWorkspaceState(
  request: Request,
  path: string,
  store: Pick<WorkspaceStore, "entry" | "list"> = workspaceStore,
) {
  if (admitBrowserRequest(request, "page")) return null;
  const cache = new QueryClient();
  try {
    const entry = await store.entry(path);
    cache.setQueryData(workspaceKeys.entry(path), entry);
    const folder =
      entry.kind === "directory"
        ? path
        : path.split("/").slice(0, -1).join("/");
    const listing = await store.list(folder, request.signal);
    cache.setQueryData(workspaceKeys.list(folder), listing);
  } catch {
    // Keep a successful entry if listing failed; do not serialize server errors.
  }
  return dehydrate(cache);
}
