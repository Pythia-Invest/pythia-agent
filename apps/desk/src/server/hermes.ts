import type {
  HermesClient,
  HermesMessage,
  HermesSession,
  RunStart,
  RunStatus,
  RunUsage,
} from "./types";
import { mapHermesEvent, readHermesSse } from "./hermes-events";
import { parseHermesSkill, parseHermesToolset } from "./hermes-inventory";
import { modelError } from "./model-error";
import { modelCatalog } from "./model-catalog";

export { mapHermesEvent, readHermesSse } from "./hermes-events";

const DEFAULT_ERROR =
  "The local Hermes runtime could not complete the request.";
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  approval_not_active: "This run no longer has an active approval request.",
  approval_not_pending: "This approval request has already been resolved.",
  invalid_approval_choice: "Hermes rejected that approval choice.",
  invalid_approval_request: "Hermes rejected that approval request identifier.",
  invalid_title: "Choose a different conversation title.",
  run_not_active: "This run is no longer active in Hermes.",
  run_not_found: "Hermes could not find this run.",
  session_not_found: "Hermes could not find this conversation.",
};

export class HermesApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "HermesApiError";
    this.status = status;
    this.code = code;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function boolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function nullableString(value: unknown) {
  return value === null ? null : string(value);
}

function usage(value: unknown): RunUsage | undefined {
  const source = object(value);
  const result: RunUsage = {};
  const input = number(source.input_tokens);
  const output = number(source.output_tokens);
  const total = number(source.total_tokens);
  if (input !== undefined) result.input_tokens = input;
  if (output !== undefined) result.output_tokens = output;
  if (total !== undefined) result.total_tokens = total;
  return Object.keys(result).length ? result : undefined;
}

function safeRunError(value: unknown) {
  const classified = modelError(value);
  if (classified) return classified;
  return { error: "The Hermes run failed." };
}

function session(value: unknown): HermesSession {
  const source = object(value);
  const id = string(source.id);
  if (!id)
    throw new HermesApiError(
      "Hermes returned a session without an identifier.",
      502,
    );
  const result: HermesSession = { id };
  const title = nullableString(source.title);
  const lastActive = number(source.last_active);
  const preview = nullableString(source.preview);
  const messageCount = number(source.message_count);
  const endedAt = number(source.ended_at);
  if (title !== undefined) result.title = title;
  if (lastActive !== undefined) result.last_active = lastActive;
  if (preview !== undefined) result.preview = preview;
  if (messageCount !== undefined) result.message_count = messageCount;
  if (endedAt !== undefined) result.ended_at = endedAt;
  return result;
}

function message(value: unknown, index: number): HermesMessage {
  const source = object(value);
  const result: HermesMessage = {
    id: String(source.id ?? `message-${index}`),
    role: string(source.role) ?? "assistant",
    content: source.content ?? "",
  };
  const timestamp = number(source.timestamp);
  const toolCallId = nullableString(source.tool_call_id);
  const toolName = nullableString(source.tool_name);
  const finishReason = nullableString(source.finish_reason);
  if (timestamp !== undefined) result.timestamp = timestamp;
  if (toolCallId !== undefined) result.tool_call_id = toolCallId;
  if (toolName !== undefined) result.tool_name = toolName;
  if (source.tool_calls !== undefined) result.tool_calls = source.tool_calls;
  if (finishReason !== undefined) result.finish_reason = finishReason;
  return result;
}

type HermesClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
};

export function createHermesClient(
  options: HermesClientOptions = {},
): HermesClient {
  const fetcher = options.fetch ?? fetch;

  function config() {
    const rawBaseUrl = (
      options.baseUrl ?? process.env.PYTHIA_HERMES_API_URL
    )?.trim();
    const apiKey = (options.apiKey ?? process.env.API_SERVER_KEY)?.trim();
    if (!rawBaseUrl || !apiKey || apiKey.length < 16) {
      throw new HermesApiError(
        "The local Hermes runtime is not configured yet.",
        503,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(rawBaseUrl);
    } catch {
      throw new HermesApiError(
        "The local Hermes runtime address is invalid.",
        503,
      );
    }
    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new HermesApiError(
        "The Hermes runtime must use a loopback HTTP address.",
        503,
      );
    }
    return { baseUrl: parsed.origin, apiKey };
  }

  async function request(path: string, init: RequestInit = {}) {
    const { baseUrl, apiKey } = config();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Accept", headers.get("Accept") ?? "application/json");
    if (init.body !== undefined)
      headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        headers,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new HermesApiError("The local Hermes runtime is not ready.", 503);
    }
    if (response.ok) return response;
    let upstream = "";
    let upstreamCode = "";
    try {
      const body = object(await response.json());
      const error = body.error;
      const structured = object(error);
      upstream =
        string(error) ??
        string(structured.message) ??
        string(body.message) ??
        "";
      upstreamCode = string(structured.code) ?? string(body.code) ?? "";
    } catch {
      upstream = "";
    }
    if (response.status === 401) {
      throw new HermesApiError(
        "Desk cannot authenticate with its local Hermes runtime.",
        503,
      );
    }
    const classified = modelError(upstream);
    if (classified) {
      throw new HermesApiError(
        classified.error,
        response.status,
        classified.code,
      );
    }
    throw new HermesApiError(
      SAFE_ERROR_MESSAGES[upstreamCode] ??
        (response.status === 429
          ? "Hermes is temporarily busy. Try again shortly."
          : DEFAULT_ERROR),
      response.status,
      upstreamCode || undefined,
    );
  }

  async function json(path: string, init?: RequestInit) {
    return object(await (await request(path, init)).json());
  }

  return {
    async listSessions(limit, offset) {
      const query = new URLSearchParams({
        include_children: "false",
        limit: String(limit),
        offset: String(offset),
      });
      const body = await json(`/api/sessions?${query}`);
      return Array.isArray(body.data) ? body.data.map(session) : [];
    },
    async createSession(title) {
      const body = await json("/api/sessions", {
        body: JSON.stringify({ title }),
        method: "POST",
      });
      return session(body.session);
    },
    async renameSession(sessionId, title) {
      const body = await json(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        {
          body: JSON.stringify({ title }),
          method: "PATCH",
        },
      );
      return session(body.session);
    },
    async listMessages(sessionId) {
      const body = await json(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=500&offset=0`,
      );
      return Array.isArray(body.data) ? body.data.map(message) : [];
    },
    async modelOptions() {
      return modelCatalog(
        await json("/api/model/options", {
          signal: AbortSignal.timeout(30_000),
        }),
      );
    },
    async startRun(sessionId, input, selection) {
      const body = await json("/v1/runs", {
        body: JSON.stringify({
          input,
          session_id: sessionId,
          ...(selection
            ? {
                provider: selection.provider,
                model: selection.model,
                ...(selection.effort
                  ? { model_options: { reasoning_effort: selection.effort } }
                  : {}),
              }
            : {}),
        }),
        method: "POST",
      });
      const runId = string(body.run_id);
      if (!runId)
        throw new HermesApiError(
          "Hermes did not return a run identifier.",
          502,
        );
      return {
        run_id: runId,
        status: string(body.status) ?? "started",
        replayed: boolean(body.replayed) ?? false,
      } satisfies RunStart;
    },
    async getRun(runId) {
      const body = await json(`/v1/runs/${encodeURIComponent(runId)}`);
      const id = string(body.run_id);
      if (!id)
        throw new HermesApiError("Hermes returned an invalid run status.", 502);
      const result: RunStatus = {
        run_id: id,
        status: string(body.status) ?? "unknown",
      };
      const sessionId = string(body.session_id);
      const output = string(body.output);
      const runUsage = usage(body.usage);
      if (sessionId) result.session_id = sessionId;
      if (output !== undefined) result.output = output;
      if (body.error !== undefined)
        Object.assign(result, safeRunError(body.error));
      if (runUsage) result.usage = runUsage;
      const approval = mapHermesEvent({
        ...object(body.approval),
        event: "approval.request",
      });
      if (approval && result.status === "waiting_for_approval")
        result.approval = approval;
      return result;
    },
    async *streamRun(runId, signal) {
      const response = await request(
        `/v1/runs/${encodeURIComponent(runId)}/events`,
        {
          headers: { Accept: "text/event-stream" },
          ...(signal ? { signal } : {}),
        },
      );
      yield* readHermesSse(response);
    },
    async respondToApproval(runId, choice, requestId) {
      const body = await json(
        `/v1/runs/${encodeURIComponent(runId)}/approval`,
        {
          body: JSON.stringify({
            choice,
            ...(requestId ? { request_id: requestId } : {}),
          }),
          method: "POST",
        },
      );
      return {
        run_id: string(body.run_id) ?? runId,
        choice,
        resolved: number(body.resolved) ?? 0,
      };
    },
    async stopRun(runId) {
      const body = await json(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
        body: "{}",
        method: "POST",
      });
      return {
        run_id: string(body.run_id) ?? runId,
        status: string(body.status) ?? "stopping",
      };
    },
    async listSkills() {
      const body = await json("/v1/skills");
      if (body.object !== "list") {
        throw new HermesApiError(
          "Hermes returned an invalid skill inventory.",
          502,
        );
      }
      return Array.isArray(body.data)
        ? body.data.flatMap((entry) => {
            const parsed = parseHermesSkill(entry);
            return parsed ? [parsed] : [];
          })
        : [];
    },
    async listToolsets() {
      const body = await json("/v1/toolsets");
      if (body.object !== "list" || body.platform !== "api_server") {
        throw new HermesApiError(
          "Hermes returned an invalid API Server toolset inventory.",
          502,
        );
      }
      return Array.isArray(body.data)
        ? body.data.flatMap((entry) => {
            const parsed = parseHermesToolset(entry);
            return parsed ? [parsed] : [];
          })
        : [];
    },
  };
}

export const hermesClient = createHermesClient();
