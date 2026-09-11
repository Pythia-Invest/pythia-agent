import type { HermesClient, RunStart, RunStatus } from "./types";
import { mapHermesEvent, readHermesSse } from "./hermes-events";
import { parseHermesSkill, parseHermesToolset } from "./hermes-inventory";
import {
  boolean,
  HermesApiError,
  message,
  number,
  object,
  runError,
  session,
  string,
  usage,
} from "./hermes-records";
import { modelCatalog } from "./model-catalog";

export { HermesApiError } from "./hermes-records";
export { mapHermesEvent, readHermesSse } from "./hermes-events";

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
    const message = upstream
      ? upstream.replaceAll(apiKey, "[redacted]")
      : `Hermes returned HTTP ${response.status}.`;
    throw new HermesApiError(
      message,
      response.status,
      upstreamCode || undefined,
    );
  }

  async function json(path: string, init?: RequestInit) {
    return object(await (await request(path, init)).json());
  }

  return {
    async capabilities() {
      const body = await json("/v1/capabilities");
      const features = object(body.features);
      return {
        runSteer: features.run_steer === true,
        modelOptions: features.model_options === true,
      };
    },
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
    async listMessages(sessionId, limit, offset) {
      const body = await json(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}&offset=${offset}&order=latest`,
      );
      const pagination = object(body.pagination);
      const data = Array.isArray(body.data) ? body.data.map(message) : [];
      return {
        data,
        limit: number(pagination.limit) ?? limit,
        offset: number(pagination.offset) ?? offset,
        returned: number(pagination.returned) ?? data.length,
      };
    },
    async modelOptions(refresh = false) {
      return modelCatalog(
        await json(`/api/model/options${refresh ? "?refresh=true" : ""}`, {
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
      if (body.error !== undefined) Object.assign(result, runError(body.error));
      if (runUsage) result.usage = runUsage;
      const pendingSteer = string(body.pending_steer);
      if (pendingSteer) result.pending_steer = pendingSteer;
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
    async steerRun(runId, input) {
      const body = await json(`/v1/runs/${encodeURIComponent(runId)}/steer`, {
        body: JSON.stringify({ input }),
        method: "POST",
      });
      return {
        run_id: string(body.run_id) ?? runId,
        accepted: boolean(body.accepted) ?? false,
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
