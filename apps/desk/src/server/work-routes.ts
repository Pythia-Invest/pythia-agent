import { admitBrowserRequest } from "./admission";
import { identifier, result, routeError } from "./route-utils";
import type { HermesClient } from "./types";
import { readAgent, readWork } from "./work";

type RouteContext = { params: Promise<Record<string, string>> };

/** A chat's native work, or one delegated agent's, read page by page. */
export function createWorkRoutes(client: HermesClient) {
  return {
    async work(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const sessionId = identifier(
          (await context.params).sessionId,
          "Session",
        );
        const query = new URL(request.url).searchParams;
        const offset = Math.min(
          100_000,
          Math.max(0, Math.floor(Number(query.get("offset")) || 0)),
        );
        const child = query.get("child");
        return result(
          child
            ? await readAgent(
                client,
                sessionId,
                identifier(child, "Agent"),
                offset,
                request.signal,
              )
            : await readWork(client, sessionId, offset, request.signal),
        );
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
