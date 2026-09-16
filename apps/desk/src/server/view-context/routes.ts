import { admitBrowserRequest, browserAdmissionNames } from "../admission";
import { result, routeError } from "../route-utils";
import { HermesApiError } from "../hermes-records";
import { workspaceStore, type WorkspaceStore } from "../workspace/store";
import { deskViewStore, type DeskViewStore } from "./store";
import { tabId, validateView, viewReference } from "./validation";
export function admittedViewOwner(request: Request) {
  // Only call after mutation admission has matched this token to its cookie.
  return request.headers.get(browserAdmissionNames.csrfHeader) ?? "";
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HermesApiError("A Desk view update is required.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new HermesApiError("The Desk view update is too large.", 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HermesApiError(
      "The Desk view update must be a JSON object.",
      400,
    );
  }
}
export function createDeskViewRoutes(
  store: DeskViewStore = deskViewStore,
  workspace: WorkspaceStore = workspaceStore,
) {
  function mutation(terminate: boolean) {
    return async (request: Request) => {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const value = await body(request);
        const owner = admittedViewOwner(request);
        const tab = tabId(value.tab_id),
          ref = viewReference(value.view_reference);
        if (terminate) return result(await store.terminate(owner, tab, ref));
        const view = await validateView(value.view, workspace);
        return result(
          await store.publish(owner, tab, ref, value.sequence as number, view),
        );
      } catch (error) {
        return routeError(error);
      }
    };
  }
  return {
    publishDeskView: mutation(false),
    terminateDeskView: mutation(true),
  };
}
