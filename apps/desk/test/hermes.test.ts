import { describe, expect, it, vi } from "vitest";
import {
  createHermesClient,
  HermesApiError,
  mapHermesEvent,
  readHermesSse,
} from "@/server/hermes";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

describe("Hermes adapter", () => {
  it("uses Hermes' native cache-busting model refresh only when requested", async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      paths.push(
        new URL(String(input)).pathname + new URL(String(input)).search,
      );
      return json({ provider: "", model: "", providers: [] });
    });
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "http://127.0.0.1:8642",
      fetch: fetcher as typeof fetch,
    });

    await client.modelOptions();
    await client.modelOptions(true);

    expect(paths).toEqual([
      "/api/model/options",
      "/api/model/options?refresh=true",
    ]);
  });

  it("omits an absent suggested title for native untitled creation", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({});
      return json({ session: { id: "native-generated", title: null } }, 201);
    });
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "http://127.0.0.1:8642",
      fetch: fetcher as typeof fetch,
    });
    expect(await client.createSession()).toEqual({
      id: "native-generated",
      title: null,
    });
  });
  it("uses the qualified session fields and native list query", async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain(
          "/api/sessions?include_children=false&limit=60&offset=0",
        );
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer local-key-1234567890",
        );
        return json({
          data: [
            {
              id: "s-1",
              title: null,
              preview: "hello",
              source: "not-consumed",
              pinned: true,
            },
          ],
        });
      },
    );
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "http://127.0.0.1:8642",
      fetch: fetcher as typeof fetch,
    });
    await expect(client.listSessions(60, 0)).resolves.toEqual([
      { id: "s-1", title: null, preview: "hello" },
    ]);
  });

  it("calls native create/run/approval/stop endpoints without a compatibility API", async () => {
    const calls: Array<{ path: string; body: unknown; method: string }> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        calls.push({
          path,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          method: init?.method ?? "GET",
        });
        if (path === "/api/sessions")
          return json({ session: { id: "s-1", title: "Apple" } }, 201);
        if (path === "/v1/runs")
          return json(
            { run_id: "r-1", status: "started", replayed: false },
            202,
          );
        if (path.endsWith("/approval"))
          return json({ run_id: "r-1", choice: "once", resolved: 1 });
        if (path.endsWith("/steer"))
          return json({ run_id: "r-1", accepted: true });
        return json({ run_id: "r-1", status: "stopping" });
      },
    );
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "http://127.0.0.1:8642",
      fetch: fetcher as typeof fetch,
    });
    await client.createSession("Apple");
    await client.startRun("s-1", "Review Apple");
    await client.respondToApproval("r-1", "once", "a-1");
    await client.steerRun("r-1", "Focus on the filing");
    await client.stopRun("r-1");
    expect(calls).toEqual([
      { path: "/api/sessions", body: { title: "Apple" }, method: "POST" },
      {
        path: "/v1/runs",
        body: { input: "Review Apple", session_id: "s-1" },
        method: "POST",
      },
      {
        path: "/v1/runs/r-1/approval",
        body: { choice: "once", request_id: "a-1" },
        method: "POST",
      },
      {
        path: "/v1/runs/r-1/steer",
        body: { input: "Focus on the filing" },
        method: "POST",
      },
      { path: "/v1/runs/r-1/stop", body: {}, method: "POST" },
    ]);
  });

  it("requests newest-first message pages and keeps native pagination", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain(
        "/api/sessions/s-1/messages?limit=100&offset=200&order=latest",
      );
      return json({
        data: [{ id: "m-1", role: "assistant", content: "Recent" }],
        pagination: { limit: 100, offset: 200, returned: 1 },
      });
    });
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "http://127.0.0.1:8642",
      fetch: fetcher as typeof fetch,
    });
    await expect(client.listMessages("s-1", 100, 200)).resolves.toEqual({
      data: [{ id: "m-1", role: "assistant", content: "Recent" }],
      limit: 100,
      offset: 200,
      returned: 1,
    });
  });

  it("reads only the qualified native skill and API Server toolset fields", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/skills") {
        return json({
          object: "list",
          data: [
            {
              name: "sec-edgar-research",
              description: "Effective native description",
              category: "finance",
              private_path: "/never/consume",
            },
            { invalid: true },
          ],
        });
      }
      return json({
        object: "list",
        platform: "api_server",
        data: [
          {
            name: "pythia-sec",
            label: "Pythia SEC",
            description: "SEC tools",
            enabled: true,
            configured: false,
            tools: ["pythia_sec_company", 7],
            private_config: "drop",
          },
        ],
      });
    });
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "http://127.0.0.1:8642",
      fetch: fetcher as typeof fetch,
    });
    await expect(client.listSkills()).resolves.toEqual([
      {
        name: "sec-edgar-research",
        description: "Effective native description",
        category: "finance",
      },
    ]);
    await expect(client.listToolsets()).resolves.toEqual([
      {
        name: "pythia-sec",
        label: "Pythia SEC",
        description: "SEC tools",
        enabled: true,
        configured: false,
        tools: ["pythia_sec_company"],
      },
    ]);
  });

  it("redacts the Hermes bearer without replacing upstream failure text", async () => {
    const secret = "secret-local-bearer-value";
    const client = createHermesClient({
      apiKey: secret,
      baseUrl: "http://127.0.0.1:8642",
      fetch: (async () =>
        json(
          { error: { message: `failure ${secret} SENSITIVE_PROVIDER_VALUE` } },
          500,
        )) as typeof fetch,
    });
    let caught: unknown;
    try {
      await client.listSessions(60, 0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HermesApiError);
    expect(String(caught)).not.toContain(secret);
    expect(String(caught)).toContain("[redacted]");
    expect(String(caught)).toContain("SENSITIVE_PROVIDER_VALUE");
  });

  it("preserves a model authentication failure from Hermes", async () => {
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "http://127.0.0.1:8642",
      fetch: (async () =>
        json(
          {
            error: {
              message: "Provider authentication failed: No model credentials",
            },
          },
          400,
        )) as typeof fetch,
    });
    await expect(client.startRun("s-1", "hello")).rejects.toThrow(
      "Provider authentication failed: No model credentials",
    );
  });

  it("refuses to send the server bearer to a non-loopback runtime address", async () => {
    const fetcher = vi.fn(async () => json({ data: [] }));
    const client = createHermesClient({
      apiKey: "local-key-1234567890",
      baseUrl: "https://example.com/hermes",
      fetch: fetcher as typeof fetch,
    });
    await expect(client.listSessions(60, 0)).rejects.toThrow(
      "loopback HTTP address",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves qualified partial events and ignores unknown event types", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              ': keepalive\n\ndata: {"event":"message.delta","run_id":"r-1",',
            ),
          );
          controller.enqueue(
            encoder.encode(
              '"delta":"Hel","private":"drop"}\n\ndata: {"event":"future.event","x":1}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode(
              'data: {"event":"approval.request","run_id":"r-1","request_id":"a-1","choices":["once","deny","future"]}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode(
              'data: {"event":"run.completed","run_id":"r-1","output":"Hello"}\n\n',
            ),
          );
          controller.close();
        },
      }),
    );
    const events = [];
    for await (const event of readHermesSse(response)) events.push(event);
    expect(events).toEqual([
      { event: "message.delta", run_id: "r-1", delta: "Hel" },
      {
        event: "approval.request",
        run_id: "r-1",
        request_id: "a-1",
        choices: ["once", "deny"],
      },
      { event: "run.completed", run_id: "r-1", output: "Hello" },
    ]);
  });

  it("passes the upstream-redacted command through for informed approval", () => {
    expect(
      mapHermesEvent({
        event: "approval.request",
        request_id: "a",
        command: "rm /tmp/generated.txt",
        description: "Delete a file",
        choices: ["once", "deny"],
        private_field: "ignored",
      }),
    ).toEqual({
      event: "approval.request",
      request_id: "a",
      command: "rm /tmp/generated.txt",
      description: "Delete a file",
      choices: ["once", "deny"],
    });
  });

  it("keeps approval, responded, cancellation, and disconnect semantics distinct", () => {
    expect(
      mapHermesEvent({
        event: "approval.request",
        run_id: "r",
        description: "Run command",
      }),
    ).toMatchObject({ event: "approval.request" });
    expect(
      mapHermesEvent({
        event: "approval.responded",
        run_id: "r",
        choice: "deny",
      }),
    ).toMatchObject({ event: "approval.responded", choice: "deny" });
    expect(mapHermesEvent({ event: "run.cancelled", run_id: "r" })).toEqual({
      event: "run.cancelled",
      run_id: "r",
    });
    expect(
      mapHermesEvent({
        event: "run.failed",
        run_id: "r",
        error: "Error from provider: Model is unavailable.",
        code: "provider_error",
      }),
    ).toEqual({
      event: "run.failed",
      run_id: "r",
      error: "Error from provider: Model is unavailable.",
      code: "provider_error",
    });
    expect(
      mapHermesEvent({ event: "stream.disconnected", run_id: "r" }),
    ).toBeNull();
  });
});
