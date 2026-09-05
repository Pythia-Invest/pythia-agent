import { admitBrowserRequest, issueBrowserSession } from "./admission";
import {
  deviceSettingsService,
  type DeviceSettingsService,
} from "./device-settings";
import { HermesApiError, hermesClient } from "./hermes";
import {
  releaseStatusService,
  type ReleaseStatusService,
} from "./release-status";
import { createSettingsRoutes } from "./settings-routes";
import { parseModelSelection, type ModelSelection } from "./model-catalog";
import type { ApprovalChoice, DeskRunEvent, HermesClient } from "./types";

type RouteContext = { params: Promise<Record<string, string>> };

function result(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function routeError(error: unknown) {
  if (error instanceof HermesApiError) {
    return result(
      { error: { code: error.code ?? "hermes_error", message: error.message } },
      error.status,
    );
  }
  return result(
    {
      error: {
        code: "desk_error",
        message: "Pythia Desk could not complete the request.",
      },
    },
    500,
  );
}

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 65_536)
    throw new HermesApiError("The request is too large.", 413);
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HermesApiError("The request must contain a JSON object.", 400);
  }
}

function textField(
  body: Record<string, unknown>,
  field: string,
  maximum: number,
  label: string,
) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  if (!value || value.length > maximum || /[\0]/u.test(value)) {
    throw new HermesApiError(
      `${label} is required and must be at most ${maximum} characters.`,
      400,
    );
  }
  return value;
}

function identifier(value: string | undefined, label: string) {
  const clean = value?.trim() ?? "";
  if (!clean || clean.length > 512 || /[\r\n\0]/u.test(clean)) {
    throw new HermesApiError(`A valid ${label} is required.`, 400);
  }
  return clean;
}

function eventStream(client: HermesClient, runId: string, signal: AbortSignal) {
  const iterator = client.streamRun(runId, signal);
  const encoder = new TextEncoder();
  let terminal = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          if (!terminal) {
            const disconnected: DeskRunEvent = {
              event: "stream.disconnected",
              run_id: runId,
              code: "stream_disconnected",
              error:
                "The live event stream closed. The Hermes run may still be active.",
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(disconnected)}\n\n`),
            );
          }
          controller.close();
          return;
        }
        terminal = ["run.completed", "run.failed", "run.cancelled"].includes(
          next.value.event,
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`),
        );
      } catch (error) {
        if (signal.aborted) {
          controller.close();
          return;
        }
        const response = routeError(error);
        const body = (await response.json()) as {
          error: { code: string; message: string };
        };
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ event: "run.failed", run_id: runId, ...body.error })}\n\n`,
          ),
        );
        controller.close();
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

export function createDeskRoutes(
  client: HermesClient,
  settings: DeviceSettingsService = deviceSettingsService,
  releases: ReleaseStatusService = releaseStatusService,
) {
  return {
    async modelOptions(request: Request) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        return result(await client.modelOptions());
      } catch (error) {
        return routeError(error);
      }
    },
    health(request: Request) {
      const rejection = admitBrowserRequest(request, "health");
      return rejection ?? result({ service: "pythia-desk", status: "ok" });
    },
    browserSession(request: Request) {
      return issueBrowserSession(request);
    },
    preflight(request: Request) {
      return (
        admitBrowserRequest(request, "read") ??
        result({}, 405, { Allow: "GET, POST, PATCH" })
      );
    },
    async listSessions(request: Request) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const url = new URL(request.url);
        const limit = Math.min(
          100,
          Math.max(1, Number(url.searchParams.get("limit") ?? 60) || 60),
        );
        const offset = Math.max(
          0,
          Number(url.searchParams.get("offset") ?? 0) || 0,
        );
        return result({ data: await client.listSessions(limit, offset) });
      } catch (error) {
        return routeError(error);
      }
    },
    async updateStatus(request: Request) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        return result(await releases.snapshot());
      } catch (error) {
        return routeError(error);
      }
    },
    async createSession(request: Request) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const title = textField(
          await readBody(request),
          "title",
          120,
          "A session title",
        );
        const session = await client
          .createSession(title)
          .catch((error: unknown) => {
            // Native invalid_title rolls back creation. Retry exactly once without
            // our suggested title; never retry an ambiguous transport failure.
            if (
              error instanceof HermesApiError &&
              error.status === 400 &&
              error.code === "invalid_title"
            )
              return client.createSession();
            throw error;
          });
        return result({ session }, 201);
      } catch (error) {
        return routeError(error);
      }
    },
    async renameSession(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const sessionId = identifier(
          (await context.params).sessionId,
          "session identifier",
        );
        const title = textField(
          await readBody(request),
          "title",
          120,
          "A session title",
        );
        return result({
          session: await client.renameSession(sessionId, title),
        });
      } catch (error) {
        return routeError(error);
      }
    },
    async listMessages(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const sessionId = identifier(
          (await context.params).sessionId,
          "session identifier",
        );
        return result({ data: await client.listMessages(sessionId) });
      } catch (error) {
        return routeError(error);
      }
    },
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
        const input = textField(body, "input", 60_000, "A message");
        let selection: ModelSelection | undefined;
        try {
          selection = parseModelSelection(body.selection);
        } catch {
          throw new HermesApiError(
            "Choose a provider, model and valid reasoning effort.",
            400,
          );
        }
        return result(await client.startRun(sessionId, input, selection), 202);
      } catch (error) {
        return routeError(error);
      }
    },
    async getRun(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const runId = identifier(
          (await context.params).runId,
          "run identifier",
        );
        return result(await client.getRun(runId));
      } catch (error) {
        return routeError(error);
      }
    },
    async streamRun(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const runId = identifier(
          (await context.params).runId,
          "run identifier",
        );
        return new Response(eventStream(client, runId, request.signal), {
          headers: {
            "Cache-Control": "no-cache, no-store",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream",
            "X-Accel-Buffering": "no",
          },
        });
      } catch (error) {
        return routeError(error);
      }
    },
    async respondToApproval(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const runId = identifier(
          (await context.params).runId,
          "run identifier",
        );
        const body = await readBody(request);
        const rawChoice = body.choice;
        const choices = new Set<ApprovalChoice>([
          "once",
          "session",
          "always",
          "deny",
        ]);
        if (
          typeof rawChoice !== "string" ||
          !choices.has(rawChoice as ApprovalChoice)
        ) {
          throw new HermesApiError(
            "Choose approve once, approve for this session, always approve, or reject.",
            400,
          );
        }
        const requestId =
          body.request_id === undefined
            ? undefined
            : textField(
                body,
                "request_id",
                256,
                "An approval request identifier",
              );
        return result(
          await client.respondToApproval(
            runId,
            rawChoice as ApprovalChoice,
            requestId,
          ),
        );
      } catch (error) {
        return routeError(error);
      }
    },
    async stopRun(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const runId = identifier(
          (await context.params).runId,
          "run identifier",
        );
        await readBody(request);
        return result(await client.stopRun(runId));
      } catch (error) {
        return routeError(error);
      }
    },
    ...createSettingsRoutes(settings),
  };
}

export const deskRoutes = createDeskRoutes(hermesClient);
