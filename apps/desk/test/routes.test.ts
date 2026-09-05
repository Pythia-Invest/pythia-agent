import { describe, expect, it, vi } from "vitest";
import { browserAdmissionNames } from "@/server/admission";
import { createDeskRoutes } from "@/server/routes";
import { HermesApiError } from "@/server/hermes";
import type { DeviceSettingsService } from "@/server/device-settings";
import type { HermesClient } from "@/server/types";
import type { ReleaseStatusService } from "@/server/release-status";

function fakeClient() {
  return {
    modelOptions: vi.fn(async () => ({
      provider: "",
      model: "",
      providers: [],
    })),
    listSessions: vi.fn(async () => []),
    createSession: vi.fn(async (title?: string) => ({
      id: "s-1",
      title: title ?? null,
    })),
    renameSession: vi.fn(async (id: string, title: string) => ({ id, title })),
    listMessages: vi.fn(async () => []),
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
    stopRun: vi.fn(async () => ({ run_id: "r-1", status: "stopping" })),
    listSkills: vi.fn(async () => []),
    listToolsets: vi.fn(async () => []),
  } satisfies HermesClient;
}

function fakeSettings() {
  return {
    snapshot: vi.fn(async () => ({
      model_auth: {
        provider: "openai-codex" as const,
        status: "missing" as const,
        setup_command: "just auth openai-codex",
      },
      sec_identity: { status: "missing" as const },
      eodhd_credential: { status: "missing" as const },
      basic_memory: { status: "ready" as const },
      skills: [],
      skills_status: "ready" as const,
      toolsets: [],
      toolsets_status: "ready" as const,
    })),
    setSecIdentity: vi.fn(async () => ({ status: "configured" as const })),
    setEodhdToken: vi.fn(async () => ({ status: "configured" as const })),
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
  } satisfies DeviceSettingsService;
}

function fakeReleases() {
  return {
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
      cookie: `${browserAdmissionNames.sessionCookie}=${token}`,
      host: "127.0.0.1:43121",
      origin,
      [browserAdmissionNames.csrfHeader]: token,
    },
    method,
  });
}

describe("Desk routes", () => {
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
  it("admits catalog reads and validates selections before starting a run", async () => {
    const client = fakeClient();
    const routes = createDeskRoutes(client);
    expect(
      (
        await routes.modelOptions(
          readRequest("/api/models", { origin: "null" }),
        )
      ).status,
    ).toBe(403);
    expect(client.modelOptions).not.toHaveBeenCalled();
    expect((await routes.modelOptions(readRequest("/api/models"))).status).toBe(
      200,
    );
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
  it("rejects hostile reads before the adapter", async () => {
    const client = fakeClient();
    const routes = createDeskRoutes(client);
    const response = await routes.listSessions(
      readRequest("/api/sessions", { origin: "null" }),
    );
    expect(response.status).toBe(403);
    expect(client.listSessions).not.toHaveBeenCalled();
  });

  it("rejects missing CSRF before parsing state or calling the adapter", async () => {
    const client = fakeClient();
    const routes = createDeskRoutes(client);
    const request = new Request(`${origin}/api/sessions`, {
      body: JSON.stringify({ title: "Never read" }),
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:43121",
        origin,
      },
      method: "POST",
    });
    const response = await routes.createSession(request);
    expect(response.status).toBe(403);
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("uses native session rename, approval, and cancellation calls", async () => {
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

  it("reports a non-terminal upstream close without claiming cancellation", async () => {
    const client = fakeClient();
    (client as HermesClient).streamRun = async function* () {
      yield { event: "tool.started", run_id: "r-1" };
    };
    const routes = createDeskRoutes(client);
    const response = await routes.streamRun(
      readRequest("/api/runs/r-1/events"),
      { params: Promise.resolve({ runId: "r-1" }) },
    );
    const text = await response.text();
    expect(text).toContain("stream.disconnected");
    expect(text).not.toContain("run.cancelled");
  });

  it.each([
    ["foreign Origin", { origin: "https://attacker.example" }],
    ["opaque Origin", { origin: "null" }],
    ["hostile Host", { host: "attacker.example:43121" }],
    ["cross-site metadata", { "sec-fetch-site": "cross-site", origin: "" }],
  ])(
    "rejects settings reads from %s before any device action",
    async (_label, headers) => {
      const settings = fakeSettings();
      const routes = createDeskRoutes(fakeClient(), settings);
      const response = await routes.settingsSnapshot(
        readRequest("/api/settings", headers),
      );
      expect(response.status).toBe(403);
      expect(settings.snapshot).not.toHaveBeenCalled();
    },
  );

  it("rejects settings mutations before body, state, or native command action", async () => {
    const settings = fakeSettings();
    const routes = createDeskRoutes(fakeClient(), settings);
    const request = new Request(`${origin}/api/settings/eodhd-token`, {
      body: JSON.stringify({ token: "NEVER_READ_SECRET" }),
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:43121",
        origin,
      },
      method: "PATCH",
    });
    expect((await routes.setEodhdToken(request)).status).toBe(403);
    expect(settings.setEodhdToken).not.toHaveBeenCalled();

    const hostileSkill = new Request(`${origin}/api/settings/skills/secret`, {
      body: JSON.stringify({ enabled: false }),
      headers: {
        "content-type": "application/json",
        host: "attacker.example:43121",
        origin: "https://attacker.example",
      },
      method: "POST",
    });
    expect(
      (
        await routes.setSkillEnabled(hostileSkill, {
          params: new Promise(() => undefined),
        })
      ).status,
    ).toBe(403);
    expect(settings.setSkillEnabled).not.toHaveBeenCalled();
  });

  it("admits read-only update status and rejects hostile callers first", async () => {
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
    const rejected = await routes.updateStatus(
      readRequest("/api/update-status", { host: "attacker.example" }),
    );
    expect(rejected.status).toBe(403);
    expect(releases.snapshot).toHaveBeenCalledTimes(1);
  });

  it("returns only readiness after admitted credential writes", async () => {
    const settings = fakeSettings();
    const routes = createDeskRoutes(fakeClient(), settings);
    const secret = "PRIVATE_EODHD_VALUE";
    const response = await routes.setEodhdToken(
      mutation(
        "/api/settings/eodhd-token",
        { token: secret },
        "T".repeat(43),
        "PATCH",
      ),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"status":"configured"');
    expect(text).not.toContain(secret);
    expect(settings.setEodhdToken).toHaveBeenCalledWith(secret);
  });
});
