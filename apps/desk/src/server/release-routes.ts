import { admitBrowserRequest } from "./admission";
import type { ReleaseStatusService } from "./release-status";
import { readBody, result, routeError, textField } from "./route-utils";

export function createReleaseRoutes(releases: ReleaseStatusService) {
  return {
    async updateStatus(request: Request) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        return result(
          await releases.snapshot(
            new URL(request.url).searchParams.get("check") === "1",
          ),
        );
      } catch (error) {
        return routeError(error);
      }
    },
    async startUpdate(request: Request) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const body = await readBody(request);
        return result(
          await releases.start({
            current: textField(body, "current", 64, "The current build"),
            target: textField(body, "target", 64, "The selected update build"),
          }),
          202,
        );
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
