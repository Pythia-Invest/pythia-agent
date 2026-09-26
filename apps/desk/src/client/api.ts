import { BrowserRequest, DeskApiError, bodyError } from "./browser-request";
export { DeskApiError } from "./browser-request";
import { readLimitedBytes } from "./response-bytes";
import type { ReadInput } from "@pythia/market-data";
import type { FinancialRead } from "@pythia/market-data/widgets/contract";
import {
  readDataUpdates,
  type DataResource,
  type PluginRequest,
} from "./data-protocol";
import type { NativeSessionContext } from "@/workspace/session-context";
import type { DeskRunStart, WorkspaceTurn } from "@/workspace/references";
import type { DeskViewPublication } from "@/view-context/types";
import {
  WORKSPACE_PREVIEW_BYTES,
  type WorkspaceEntry,
  type WorkspaceListing,
  type WorkspaceSearch,
} from "@/workspace/types";
import { workspaceContentUrl } from "@/workspace/paths";
import type { Attachment } from "@/attachments";
import type {
  ApprovalChoice,
  DeskRunEvent,
  HermesMessagePage,
  HermesCapabilities,
  HermesSession,
  RunStatus,
} from "@/server/types";
import type {
  DeviceSettingsSnapshot,
  DeviceSkill,
} from "@/server/device-settings";
import type { HermesToolset } from "@/server/types";
import type { DeskReleaseStatus } from "@/server/release-status";
import type { ModelCatalog, ModelSelection } from "@/server/model-catalog";

function parseFrame(frame: string) {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as DeskRunEvent;
  } catch {
    return null;
  }
}

export class DeskApi extends BrowserRequest {
  async *dataUpdates(resources: DataResource[], signal: AbortSignal) {
    if (!this.csrfToken) await this.initialize();
    const response = await fetch("/api/data/updates", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Pythia-CSRF": this.csrfToken,
      },
      body: JSON.stringify({ resources }),
    });
    if (!response.ok) {
      const error = await bodyError(response);
      throw new DeskApiError(error.message, response.status, error.code);
    }
    if (
      !response.headers.get("content-type")?.startsWith("text/event-stream")
    ) {
      await response.body?.cancel();
      throw new DeskApiError("The update stream was invalid.", 502);
    }
    yield* readDataUpdates(response);
  }

  financialRead(reads: ReadInput[], signal?: AbortSignal) {
    return this.json<FinancialRead[]>("/api/markets/read", {
      method: "POST",
      body: JSON.stringify({ reads }),
      ...(signal ? { signal } : {}),
    });
  }

  /** A plugin's current native widget declarations and module URLs. */
  widgetPresentation(plugin: string, signal?: AbortSignal) {
    return this.json<{
      widgets: { id: string; asset: string; input_contract: string }[];
      assets: { id: string; moduleUrl: string }[];
    }>(
      `/api/plugins/${encodeURIComponent(plugin)}/widgets`,
      signal ? { signal } : {},
    );
  }

  topBar(signal?: AbortSignal) {
    return this.json<import("@/top-bar/config").TopBarSelection>(
      "/api/desk/top-bar",
      signal ? { signal } : {},
    );
  }

  pluginInvoke(request: PluginRequest, signal?: AbortSignal) {
    return this.json<unknown>("/api/data/invoke", {
      method: "POST",
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
  }

  pluginRead(request: PluginRequest, signal?: AbortSignal) {
    return this.json<unknown>("/api/data/read", {
      method: "POST",
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
  }

  financialPreferences(signal?: AbortSignal) {
    return this.json<{ revision: number }>(
      "/api/markets/preferences",
      signal ? { signal } : {},
    );
  }

  workspaceEntry(path: string, signal?: AbortSignal) {
    return this.json<WorkspaceEntry>(
      `/api/workspace/entry?${new URLSearchParams({ path })}`,
      { ...(signal ? { signal } : {}) },
    );
  }

  workspaceList(path: string, signal?: AbortSignal) {
    return this.json<WorkspaceListing>(
      `/api/workspace/list?${new URLSearchParams({ path })}`,
      { ...(signal ? { signal } : {}) },
    );
  }

  workspaceSearch(path: string, q: string, signal?: AbortSignal) {
    return this.json<WorkspaceSearch>(
      `/api/workspace/search?${new URLSearchParams({ path, q })}`,
      { ...(signal ? { signal } : {}) },
    );
  }

  resolveWorkspaceHostPath(hostPath: string, signal?: AbortSignal) {
    return this.json<{ path: string }>(
      `/api/workspace/resolve?${new URLSearchParams({ hostPath })}`,
      { ...(signal ? { signal } : {}) },
    );
  }

  async workspaceBytes(
    path: string,
    revision: string,
    limit: number,
    signal: AbortSignal,
  ) {
    const response = await fetch(
      `${workspaceContentUrl(path)}&revision=${encodeURIComponent(revision)}`,
      { signal, cache: "no-store", credentials: "same-origin" },
    );
    if (!response.ok) {
      const error = await bodyError(response);
      throw new DeskApiError(error.message, response.status, error.code);
    }
    return readLimitedBytes(response, limit);
  }

  async workspaceText(path: string, signal?: AbortSignal) {
    const response = await fetch(workspaceContentUrl(path), {
      ...(signal ? { signal } : {}),
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      const error = await bodyError(response);
      throw new DeskApiError(error.message, response.status, error.code);
    }
    if (
      Number(response.headers.get("content-length")) >
        WORKSPACE_PREVIEW_BYTES ||
      response.headers.get("content-disposition")?.startsWith("attachment")
    ) {
      await response.body?.cancel();
      throw new DeskApiError(
        "This file is available to download.",
        413,
        "workspace_preview_limit",
      );
    }
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        await readLimitedBytes(response, WORKSPACE_PREVIEW_BYTES),
      ),
      revision: response.headers.get("x-workspace-revision") ?? "",
    };
  }

  async listSessions(limit = 60, offset = 0) {
    return (
      await this.json<{ data: HermesSession[] }>(
        `/api/sessions?limit=${limit}&offset=${offset}`,
      )
    ).data;
  }

  settings() {
    return this.json<DeviceSettingsSnapshot>("/api/settings");
  }

  updateStatus() {
    return this.json<DeskReleaseStatus>("/api/update-status");
  }

  async setSkillEnabled(name: string, enabled: boolean) {
    return (
      await this.json<{ skill: DeviceSkill }>(
        `/api/settings/skills/${encodeURIComponent(name)}`,
        { body: JSON.stringify({ enabled }), method: "POST" },
      )
    ).skill;
  }

  async setToolsetEnabled(name: string, enabled: boolean) {
    return (
      await this.json<{ toolset: HermesToolset }>(
        `/api/settings/toolsets/${encodeURIComponent(name)}`,
        { body: JSON.stringify({ enabled }), method: "POST" },
      )
    ).toolset;
  }

  async createSession(title: string) {
    return (
      await this.json<{ session: HermesSession }>("/api/sessions", {
        body: JSON.stringify({ title }),
        method: "POST",
      })
    ).session;
  }

  async renameSession(sessionId: string, title: string) {
    return (
      await this.json<{ session: HermesSession }>(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        { body: JSON.stringify({ title }), method: "PATCH" },
      )
    ).session;
  }

  listMessages(sessionId: string, limit = 100, offset = 0) {
    return this.json<HermesMessagePage>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}&offset=${offset}`,
    );
  }

  sessionContext(sessionId: string, signal?: AbortSignal) {
    return this.json<NativeSessionContext>(
      `/api/sessions/${encodeURIComponent(sessionId)}/context`,
      signal ? { signal } : undefined,
    );
  }

  capabilities() {
    return this.json<HermesCapabilities>("/api/capabilities");
  }

  modelOptions(refresh = false) {
    return this.json<ModelCatalog>(
      `/api/models${refresh ? "?refresh=true" : ""}`,
    );
  }

  async downloadAttachment(id: string) {
    const response = await fetch(
      `/api/attachments/${encodeURIComponent(id)}?download=true`,
      { credentials: "same-origin", cache: "no-store" },
    );
    if (!response.ok) {
      const error = await bodyError(response);
      throw new DeskApiError(error.message, response.status, error.code);
    }
    return response.blob();
  }

  uploadAttachment(
    file: { name: string; mediaType: string; data: string },
    signal?: AbortSignal,
  ) {
    return this.json<Attachment>("/api/attachments", {
      method: "POST",
      body: JSON.stringify(file),
      ...(signal ? { ...(signal ? { signal } : {}) } : {}),
    });
  }

  startRun(
    sessionId: string,
    input: string,
    selection?: ModelSelection,
    attachments?: string[],
    workspace?: WorkspaceTurn,
  ) {
    return this.json<DeskRunStart>("/api/runs", {
      body: JSON.stringify({
        session_id: sessionId,
        input,
        selection,
        ...(attachments?.length ? { attachments } : {}),
        ...(workspace ? { workspace } : {}),
      }),
      method: "POST",
    });
  }

  getRun(runId: string) {
    return this.json<RunStatus>(`/api/runs/${encodeURIComponent(runId)}`);
  }

  respondToApproval(runId: string, choice: ApprovalChoice, requestId?: string) {
    return this.json(`/api/runs/${encodeURIComponent(runId)}/approval`, {
      body: JSON.stringify({
        choice,
        ...(requestId ? { request_id: requestId } : {}),
      }),
      method: "POST",
    });
  }

  publishDeskView(publication: DeskViewPublication) {
    return this.json<{ expires_at: number }>("/api/desk-view/publish", {
      method: "POST",
      body: JSON.stringify(publication),
    });
  }

  terminateDeskView(tab_id: string, view_reference: string) {
    return this.json("/api/desk-view/terminate", {
      method: "POST",
      body: JSON.stringify({ tab_id, view_reference }),
    });
  }

  steerRun(runId: string, input: string, workspace?: WorkspaceTurn) {
    return this.json<{
      run_id: string;
      accepted: boolean;
      desk_view?: DeskRunStart["desk_view"];
    }>(`/api/runs/${encodeURIComponent(runId)}/steer`, {
      body: JSON.stringify({ input, ...(workspace ? { workspace } : {}) }),
      method: "POST",
    });
  }

  stopRun(runId: string) {
    return this.json<RunStatus>(`/api/runs/${encodeURIComponent(runId)}/stop`, {
      body: "{}",
      method: "POST",
    });
  }

  async *streamRun(runId: string, signal: AbortSignal) {
    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/events`,
      {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      },
    );
    if (!response.ok) {
      const error = await bodyError(response);
      throw new DeskApiError(error.message, response.status, error.code);
    }
    if (!response.body)
      throw new DeskApiError("The run stream was empty.", 502);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/u);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = parseFrame(frame);
          if (event) yield event;
        }
        if (done) break;
      }
      if (buffer.trim()) {
        const event = parseFrame(buffer);
        if (event) yield event;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
