import { createTurnContext } from "./turn-context";
import { admitBrowserRequest } from "../admission";
import {
  result,
  routeError,
  readBody,
  textField,
  identifier,
} from "../route-utils";
import { parseAttachmentIds, type AttachmentStore } from "../attachments";
import { parseModelSelection, type ModelSelection } from "../model-catalog";
import { HermesApiError } from "../hermes-records";
import type { HermesClient } from "../types";
import type { DeviceSettingsService } from "../device-settings";
import type { DeskViewStore } from "../view-context/store";
import type { WorkspaceStore } from "./store";
import type { NativeSessionContext } from "@/workspace/session-context";
type RouteContext = { params: Promise<Record<string, string>> };
export function createWorkspaceRunRoutes(
  client: HermesClient,
  settings: DeviceSettingsService,
  attachments: AttachmentStore,
  workspace: WorkspaceStore,
  views: DeskViewStore,
  sessionContext: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<NativeSessionContext>,
) {
  const composeTurn = createTurnContext(workspace, views, sessionContext);
  return {
    async startRun(request: Request) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const body = await readBody(request);
        const sessionId = textField(
          body,
          "session_id",
          512,
          "A session identifier",
        );
        const ids = parseAttachmentIds(body.attachments);
        const text =
          (ids.length || body.workspace) && body.input === ""
            ? ""
            : textField(body, "input", 60_000, "A message");
        const turn = await composeTurn(
          request,
          sessionId,
          text,
          body.workspace,
        );
        if (!ids.length && !turn.input.trim())
          throw new HermesApiError("A message or reference is required.", 400);
        const input = ids.length
          ? await attachments.input(turn.input, ids)
          : turn.input;
        let selection: ModelSelection | undefined;
        try {
          selection = parseModelSelection(body.selection);
        } catch {
          throw new HermesApiError(
            "Choose a provider, model and valid reasoning effort.",
            400,
          );
        }
        if (selection) await settings.initializeModel(selection);
        return result(
          {
            ...(await client.startRun(sessionId, input, selection)),
            ...(turn.desk_view ? { desk_view: turn.desk_view } : {}),
          },
          202,
        );
      } catch (error) {
        return routeError(error);
      }
    },
    async steerRun(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const runId = identifier(
          (await context.params).runId,
          "run identifier",
        );
        const body = await readBody(request);
        const text =
          body.workspace && body.input === ""
            ? ""
            : textField(body, "input", 60_000, "Guidance");
        const run = await client.getRun(runId).catch(() => null);
        const turn = await composeTurn(
          request,
          run?.session_id ?? "",
          text,
          body.workspace,
        );
        if (!turn.input.trim())
          throw new HermesApiError("Guidance or a reference is required.", 400);
        return result({
          ...(await client.steerRun(runId, turn.input)),
          ...(turn.desk_view ? { desk_view: turn.desk_view } : {}),
        });
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
