import type {
  ApprovalChoice,
  DeskRunEvent,
  HermesMessage,
  HermesSession,
  RunStart,
  RunStatus,
} from "@/server/types";
import type {
  DeviceSettingsSnapshot,
  DeviceSkill,
} from "@/server/device-settings";
import type { HermesToolset } from "@/server/types";
import type { DeskReleaseStatus } from "@/server/release-status";
import type { ModelCatalog, ModelSelection } from "@/server/model-catalog";

type ErrorBody = { error?: { code?: unknown; message?: unknown } };

export class DeskApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "DeskApiError";
    this.status = status;
    this.code = code;
  }
}

async function bodyError(response: Response) {
  try {
    const body = (await response.json()) as ErrorBody;
    return {
      code: typeof body.error?.code === "string" ? body.error.code : undefined,
      message:
        typeof body.error?.message === "string"
          ? body.error.message
          : "Pythia Desk could not complete the request.",
    };
  } catch {
    return { message: "Pythia Desk could not complete the request." };
  }
}

async function requireJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const error = await bodyError(response);
  throw new DeskApiError(error.message, response.status, error.code);
}

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

export class DeskApi {
  #csrfToken = "";

  async initialize() {
    const response = await requireJson<{ csrf_token: string }>(
      await fetch("/api/browser-session", { cache: "no-store" }),
    );
    this.#csrfToken = response.csrf_token;
  }

  async #json<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
      headers.set("X-Pythia-CSRF", this.#csrfToken);
    }
    return requireJson<T>(
      await fetch(path, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers,
      }),
    );
  }

  async listSessions() {
    return (await this.#json<{ data: HermesSession[] }>("/api/sessions")).data;
  }

  settings() {
    return this.#json<DeviceSettingsSnapshot>("/api/settings");
  }

  updateStatus() {
    return this.#json<DeskReleaseStatus>("/api/update-status");
  }

  setSecIdentity(identity: string | null) {
    return this.#json<{ status: string }>("/api/settings/sec-identity", {
      body: JSON.stringify({ identity }),
      method: "PATCH",
    });
  }

  setEodhdToken(token: string | null) {
    return this.#json<{ status: string }>("/api/settings/eodhd-token", {
      body: JSON.stringify({ token }),
      method: "PATCH",
    });
  }

  async setSkillEnabled(name: string, enabled: boolean) {
    return (
      await this.#json<{ skill: DeviceSkill }>(
        `/api/settings/skills/${encodeURIComponent(name)}`,
        { body: JSON.stringify({ enabled }), method: "POST" },
      )
    ).skill;
  }

  async setToolsetEnabled(name: string, enabled: boolean) {
    return (
      await this.#json<{ toolset: HermesToolset }>(
        `/api/settings/toolsets/${encodeURIComponent(name)}`,
        { body: JSON.stringify({ enabled }), method: "POST" },
      )
    ).toolset;
  }

  async createSession(title: string) {
    return (
      await this.#json<{ session: HermesSession }>("/api/sessions", {
        body: JSON.stringify({ title }),
        method: "POST",
      })
    ).session;
  }

  async renameSession(sessionId: string, title: string) {
    return (
      await this.#json<{ session: HermesSession }>(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        { body: JSON.stringify({ title }), method: "PATCH" },
      )
    ).session;
  }

  async listMessages(sessionId: string) {
    return (
      await this.#json<{ data: HermesMessage[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      )
    ).data;
  }

  modelOptions() {
    return this.#json<ModelCatalog>("/api/models");
  }

  startRun(sessionId: string, input: string, selection?: ModelSelection) {
    return this.#json<RunStart>("/api/runs", {
      body: JSON.stringify({ session_id: sessionId, input, selection }),
      method: "POST",
    });
  }

  getRun(runId: string) {
    return this.#json<RunStatus>(`/api/runs/${encodeURIComponent(runId)}`);
  }

  respondToApproval(runId: string, choice: ApprovalChoice, requestId?: string) {
    return this.#json(`/api/runs/${encodeURIComponent(runId)}/approval`, {
      body: JSON.stringify({
        choice,
        ...(requestId ? { request_id: requestId } : {}),
      }),
      method: "POST",
    });
  }

  stopRun(runId: string) {
    return this.#json<RunStatus>(
      `/api/runs/${encodeURIComponent(runId)}/stop`,
      {
        body: "{}",
        method: "POST",
      },
    );
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
