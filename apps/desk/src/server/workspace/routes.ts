import { admitBrowserRequest } from "../admission";
import { result, routeError } from "../route-utils";
import { workspaceStore, type WorkspaceStore } from "./store";
function workspaceError(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (["ENOENT", "ENOTDIR"].includes(code ?? ""))
    return result(
      {
        error: {
          code: "workspace_missing",
          message: "This file or folder is no longer available.",
        },
      },
      404,
    );
  if (["EACCES", "EPERM", "ELOOP"].includes(code ?? ""))
    return result(
      {
        error: {
          code: "workspace_unreadable",
          message: "This file or folder cannot be read.",
        },
      },
      403,
    );
  if (error instanceof Error && error.name === "AbortError")
    return result(
      {
        error: {
          code: "workspace_cancelled",
          message: "The request was cancelled.",
        },
      },
      499,
    );
  return routeError(error);
}
export function createWorkspaceRoutes(store: WorkspaceStore = workspaceStore) {
  function read(
    operation: (request: Request, params: URLSearchParams) => Promise<unknown>,
    response = false,
  ) {
    return async (request: Request) => {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const value = await operation(
          request,
          new URL(request.url).searchParams,
        );
        return response ? (value as Response) : result(value);
      } catch (error) {
        return workspaceError(error);
      }
    };
  }
  return {
    workspaceList: read((request, p) =>
      store.list(p.get("path") ?? "", request.signal),
    ),
    workspaceSearch: read((request, p) =>
      store.search(p.get("path") ?? "", p.get("q") ?? "", request.signal),
    ),
    workspaceEntry: read((_, p) => store.entry(p.get("path") ?? "")),
    workspaceContent: read(
      (request, p) => store.response(p.get("path") ?? "", request),
      true,
    ),
    workspaceResolve: read(async (_, p) => ({
      path: await store.resolveHostPath(p.get("hostPath") ?? ""),
    })),
  };
}
