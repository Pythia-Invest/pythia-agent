import { describe, expect, it, vi } from "vitest";
import { createDeskRoutes } from "@/server/routes";
import { HermesApiError } from "@/server/hermes";
import type { DeviceSettingsService } from "@/server/device-settings";
import type { HermesClient } from "@/server/types";
import type { ReleaseStatusService } from "@/server/release-status";

function fakeClient() {
  return {
    capabilities: vi.fn(async () => ({ runSteer: true, modelOptions: true })),
    modelOptions: vi.fn(async () => ({
      provider: "",
      model: "",
      providers: [],
    })),
    listSessions: vi.fn(async () => []),
    getSession: vi.fn(async (id: string) => ({ id })),
    createSession: vi.fn(async (title?: string) => ({
      id: "s-1",
      title: title ?? null,
    })),
    renameSession: vi.fn(async (id: string, title: string) => ({ id, title })),
    listMessages: vi.fn(async (_id: string, limit: number, offset: number) => ({
      data: [],
      limit,
      offset,
      returned: 0,
    })),
    startRun: vi.fn(async () => ({
      run_id: "r-1",
      status: "started",
      replayed: false,
    })),
    getRun: vi.fn(async () => ({ run_id: "r-1", status: "running" })),
    async *streamRun() {
      yield { event: "approval.request", run_id: "r-1", request_id: "a-1" };
      yield {
        event: "approval.responded",
        run_id: "r-1",
        request_id: "a-1",
        choice: "once" as const,
      };
      yield { event: "run.completed", run_id: "r-1", output: "done" };
    },
    respondToApproval: vi.fn(
      async (_run: string, choice: "once" | "session" | "always" | "deny") => ({
        run_id: "r-1",
        choice,
        resolved: 1,
      }),
    ),
    steerRun: vi.fn(async (runId: string) => ({
      run_id: runId,
      accepted: true,
    })),
    stopRun: vi.fn(async () => ({ run_id: "r-1", status: "stopping" })),
    listSkills: vi.fn(async () => []),
    listToolsets: vi.fn(async () => []),
  } satisfies HermesClient;
}

function fakeSettings() {
  return {
    initializeModel: vi.fn(async () => false),
    settleInitialModel: vi.fn(async () => {}),
    snapshot: vi.fn(async () => ({
      model_auth: {
        provider: "openai-codex" as const,
        status: "missing" as const,
        setup_command: "just auth openai-codex",
      },
      basic_memory: { status: "ready" as const },
      skills: [],
      skills_status: "ready" as const,
      toolsets: [],
      workspace: {
        root: null,
        native_cwd: null,
        status: "unavailable" as const,
      },
      toolsets_status: "ready" as const,
    })),
    setSkillEnabled: vi.fn(async (name: string, enabled: boolean) => ({
      name,
      enabled,
      kind: "pythia-provided-name" as const,
      mutable: true,
    })),
    setToolsetEnabled: vi.fn(async (name: string, enabled: boolean) => ({
      name,
      enabled,
      configured: true,
      tools: [],
    })),
    setPluginPaused: vi.fn(async (plugin: string, paused: boolean) => ({
      plugin,
      paused,
    })),
  } satisfies DeviceSettingsService;
}

function fakeReleases() {
  return {
    start: vi.fn(async (expected: { target: string }) => ({
      started: true as const,
      target_revision: expected.target,
    })),
    snapshot: vi.fn(async () => ({
      status: "ready" as const,
      channel: "stable" as const,
      current_version: "v0.1.0",
      target_version: "v0.2.0",
      update_available: true,
    })),
  } satisfies ReleaseStatusService;
}

const origin = "http://127.0.0.1:43121";

function readRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    headers: { host: "127.0.0.1:43121", origin, ...headers },
  });
}

function mutation(
  path: string,
  body: unknown,
  token = "T".repeat(43),
  method = "POST",
) {
  return new Request(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: `pythia_desk_session=${token}`,
      host: "127.0.0.1:43121",
      origin,
      "x-pythia-csrf": token,
    },
    method,
  });
}

describe("Desk routes", () => {
  it("projects native work for an admitted session read", async () => {
    const accepted = await createDeskRoutes(fakeClient()).work(
      readRequest("/api/sessions/s-1/work"),
      { params: Promise.resolve({ sessionId: "s-1" }) },
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      plans: [],
      agents: [],
      offset: 0,
    });
  });
  it("lets Hermes own automatic naming when no title is supplied", async () => {
    const client = fakeClient();
    const response = await createDeskRoutes(client).createSession(
      mutation("/api/sessions", {}),
    );
    expect(response.status).toBe(201);
    expect(client.createSession).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(await response.json()).toEqual({
      session: { id: "s-1", title: null },
    });
  });

  it("retries a rejected suggested title once without a title", async () => {
    const client = fakeClient();
    client.createSession.mockRejectedValueOnce(
      new HermesApiError("Title already in use", 400, "invalid_title"),
    );
    const response = await createDeskRoutes(client).createSession(
      mutation("/api/sessions", { title: "hi" }),
    );
    expect(response.status).toBe(201);
    expect(client.createSession.mock.calls).toEqual([["hi"], []]);
    expect(await response.json()).toEqual({
      session: { id: "s-1", title: null },
    });
  });

  it("does not retry ambiguous failures or retry a failed fallback", async () => {
    const client = fakeClient();
    const routes = createDeskRoutes(client);
    client.createSession.mockRejectedValueOnce(
      new HermesApiError("Unavailable", 503),
    );
    expect(
      (await routes.createSession(mutation("/api/sessions", { title: "hi" })))
        .status,
    ).toBe(503);
    expect(client.createSession).toHaveBeenCalledTimes(1);
    client.createSession.mockClear();
    client.createSession.mockRejectedValue(
      new HermesApiError("Invalid title", 400, "invalid_title"),
    );
    expect(
      (await routes.createSession(mutation("/api/sessions", { title: "hi" })))
        .status,
    ).toBe(400);
    expect(client.createSession).toHaveBeenCalledTimes(2);
  });
  it("refreshes the catalog on request and validates selections before starting a run", async () => {
    const client = fakeClient();
    const settings = fakeSettings();
    const routes = createDeskRoutes(client, settings);
    expect((await routes.modelOptions(readRequest("/api/models"))).status).toBe(
      200,
    );
    expect(client.modelOptions).toHaveBeenLastCalledWith(false);
    expect(
      (await routes.modelOptions(readRequest("/api/models?refresh=true")))
        .status,
    ).toBe(200);
    expect(client.modelOptions).toHaveBeenLastCalledWith(true);
    const selection = {
      provider: "openai-codex",
      model: "fixture-model",
      effort: "medium",
    };
    expect(
      (
        await routes.startRun(
          mutation("/api/runs", { session_id: "s", input: "hello", selection }),
        )
      ).status,
    ).toBe(202);
    expect(client.startRun).toHaveBeenCalledWith("s", "hello", selection);
    expect(settings.initializeModel).toHaveBeenCalledWith(selection);
    expect(settings.settleInitialModel).not.toHaveBeenCalled();
    settings.initializeModel.mockResolvedValueOnce(true);
    await routes.startRun(
      mutation("/api/runs", { session_id: "s", input: "hello", selection }),
    );
    expect(settings.settleInitialModel).toHaveBeenCalledWith(selection, "r-1");
    client.startRun.mockClear();
    expect(
      (
        await routes.startRun(
          mutation("/api/runs", {
            session_id: "s",
            input: "hello",
            selection: { ...selection, base_url: "https://private" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(client.startRun).not.toHaveBeenCalled();
  });
  it("uses native session rename, approval, steering, and cancellation calls", async () => {
    const client = fakeClient();
    const routes = createDeskRoutes(client);
    const renameRequest = mutation(
      "/api/sessions/s-1",
      { title: "New title" },
      "T".repeat(43),
      "PATCH",
    );
    const renamed = await routes.renameSession(renameRequest, {
      params: Promise.resolve({ sessionId: "s-1" }),
    });
    expect(renamed.status).toBe(200);
    expect(client.renameSession).toHaveBeenCalledWith("s-1", "New title");

    const approval = await routes.respondToApproval(
      mutation("/api/runs/r-1/approval", { choice: "deny", request_id: "a-1" }),
      { params: Promise.resolve({ runId: "r-1" }) },
    );
    expect(approval.status).toBe(200);
    expect(client.respondToApproval).toHaveBeenCalledWith("r-1", "deny", "a-1");

    const steered = await routes.steerRun(
      mutation("/api/runs/r-1/steer", { input: "Use the annual filing" }),
      { params: Promise.resolve({ runId: "r-1" }) },
    );
    expect(steered.status).toBe(200);
    expect(client.steerRun).toHaveBeenCalledWith(
      "r-1",
      "Use the annual filing",
    );

    const stopped = await routes.stopRun(mutation("/api/runs/r-1/stop", {}), {
      params: Promise.resolve({ runId: "r-1" }),
    });
    expect(stopped.status).toBe(200);
    expect(client.stopRun).toHaveBeenCalledWith("r-1");
  });

  it("streams approval, resumed, and terminal events separately", async () => {
    const routes = createDeskRoutes(fakeClient());
    const response = await routes.streamRun(
      readRequest("/api/runs/r-1/events"),
      { params: Promise.resolve({ runId: "r-1" }) },
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"event":"approval.request"');
    expect(text).toContain('"event":"approval.responded"');
    expect(text).toContain('"event":"run.completed"');
    expect(text).not.toContain("stream.disconnected");
  });

  it.each([
    [
      "a non-terminal upstream close",
      async function* () {
        yield { event: "tool.started" as const, run_id: "r-1" };
      },
    ],
    [
      "an unavailable native event queue",
      async function* () {
        yield await Promise.reject(new Error("Event queue unavailable"));
      },
    ],
  ])(
    "reports %s as a disconnect, not a run outcome",
    async (_label, streamRun) => {
      const client: HermesClient = { ...fakeClient(), streamRun };
      const response = await createDeskRoutes(client).streamRun(
        readRequest("/api/runs/r-1/events"),
        { params: Promise.resolve({ runId: "r-1" }) },
      );
      const text = await response.text();
      expect(text).toContain('"event":"stream.disconnected"');
      expect(text).not.toContain('"event":"run.cancelled"');
      expect(text).not.toContain('"event":"run.failed"');
    },
  );

  it("reads update status locally unless a remote check is requested", async () => {
    const releases = fakeReleases();
    const routes = createDeskRoutes(fakeClient(), fakeSettings(), releases);
    const accepted = await routes.updateStatus(
      readRequest("/api/update-status"),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      channel: "stable",
      update_available: true,
    });
    expect(releases.snapshot).toHaveBeenCalledExactlyOnceWith(false);
    await routes.updateStatus(readRequest("/api/update-status?check=1"));
    expect(releases.snapshot).toHaveBeenLastCalledWith(true);
  });

  it("hands an admitted update to the lifecycle", async () => {
    const releases = fakeReleases();
    const routes = createDeskRoutes(fakeClient(), fakeSettings(), releases);
    const expected = { current: "a".repeat(40), target: "b".repeat(40) };
    const accepted = await routes.startUpdate(
      mutation("/api/update-status", expected),
    );
    expect(accepted.status).toBe(202);
    expect(releases.start).toHaveBeenCalledWith(expected);
  });

  it("wraps the service result for an admitted toolset change", async () => {
    const settings = fakeSettings();
    const routes = createDeskRoutes(fakeClient(), settings);
    const response = await routes.setToolsetEnabled(
      mutation(
        "/api/settings/toolsets/example",
        { enabled: true },
        "T".repeat(43),
      ),
      { params: Promise.resolve({ name: "example" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      toolset: { name: "example", enabled: true, configured: true, tools: [] },
    });
    expect(settings.setToolsetEnabled).toHaveBeenCalledWith("example", true);
  });

  it("pauses a data source from an admitted request and refuses a malformed one", async () => {
    const settings = fakeSettings();
    const routes = createDeskRoutes(fakeClient(), settings);
    const pause = (body: unknown) =>
      routes.setPluginPaused(
        mutation("/api/settings/plugins/example", body, "T".repeat(43)),
        { params: Promise.resolve({ name: "example" }) },
      );
    const response = await pause({ paused: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plugin: "example", paused: true });
    expect(settings.setPluginPaused).toHaveBeenCalledWith("example", true);
    expect((await pause({ paused: "yes" })).status).toBe(400);
    expect(settings.setPluginPaused).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["read", "work", "/api/sessions/s-1/work", "client.listMessages"],
    ["read", "modelOptions", "/api/models", "client.modelOptions"],
    ["read", "listSessions", "/api/sessions", "client.listSessions"],
    ["read", "settingsSnapshot", "/api/settings", "settings.snapshot"],
    ["read", "updateStatus", "/api/update-status", "releases.snapshot"],
    ["mutation", "createSession", "/api/sessions", "client.createSession"],
    [
      "mutation",
      "setToolsetEnabled",
      "/api/settings/toolsets/x",
      "settings.setToolsetEnabled",
    ],
    [
      "mutation",
      "setSkillEnabled",
      "/api/settings/skills/x",
      "settings.setSkillEnabled",
    ],
    [
      "mutation",
      "setPluginPaused",
      "/api/settings/plugins/x",
      "settings.setPluginPaused",
    ],
    ["mutation", "startUpdate", "/api/update-status", "releases.start"],
  ] as const)(
    "admits a %s through %s before its service",
    async (kind, route, path, service) => {
      const services = {
        client: fakeClient(),
        settings: fakeSettings(),
        releases: fakeReleases(),
      };
      const routes = createDeskRoutes(
        services.client,
        services.settings,
        services.releases,
      );
      // A foreign read, or a same-origin mutation without its CSRF token.
      const request =
        kind === "read"
          ? readRequest(path, { origin: "https://attacker.example" })
          : new Request(`${origin}${path}`, {
              body: JSON.stringify({ enabled: false, title: "Never read" }),
              headers: {
                "content-type": "application/json",
                host: "127.0.0.1:43121",
                origin,
              },
              method: "POST",
            });
      const handler = routes[route] as (
        request: Request,
        context: unknown,
      ) => Promise<Response>;
      const response = await handler(request, {
        params: Promise.resolve({ sessionId: "s-1", name: "x" }),
      });
      expect(response.status).toBe(403);
      const [owner, method] = service.split(".") as [
        keyof typeof services,
        string,
      ];
      expect(
        (services[owner] as Record<string, unknown>)[method],
      ).not.toHaveBeenCalled();
    },
  );
});
