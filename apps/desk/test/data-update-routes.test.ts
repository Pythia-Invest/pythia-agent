import { afterEach, expect, test, vi } from "vitest";
import { createDataUpdateRoutes } from "../src/server/data-update-routes";

afterEach(() => vi.unstubAllGlobals());
const environment = {
  NODE_ENV: "test" as const,
  API_SERVER_KEY: "synthetic-gateway-key-123456789",
  PYTHIA_HERMES_API_URL: "http://127.0.0.1:8765",
  PYTHIA_HERMES_PROFILE: "research",
};
function request(resources: unknown[], admitted = true) {
  const token = "a".repeat(43);
  return new Request("http://localhost:8644/api/data/updates", {
    method: "POST",
    headers: {
      host: "localhost:8644",
      origin: admitted ? "http://localhost:8644" : "http://hostile.invalid",
      "content-type": "application/json",
      cookie: `pythia_desk_session=${token}`,
      "x-pythia-csrf": token,
    },
    body: JSON.stringify({ resources }),
  });
}

test("one admitted stream preserves explicit plugin ownership for otherwise equal operations", async () => {
  const stream = "data: {}\n\n";
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const resources = [
    {
      plugin: "pythia-market-data",
      operation: "query",
      arguments: { action: "get_preferences" },
    },
    {
      plugin: "research/local-feature",
      operation: "query",
      arguments: {},
      window: { kind: "samples", limit: 12 },
    },
  ];
  const response = await createDataUpdateRoutes(environment).dataUpdates(
    request(resources),
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(stream);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] ?? [];
  expect(url).toBe("http://127.0.0.1:8765/p/research/v1/pythia/updates");
  expect(JSON.parse(String(init?.body))).toEqual({ resources });
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer synthetic-gateway-key-123456789",
  );
});

test("missing or unsafe plugin ownership and untrusted browser requests never reach Hermes", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const routes = createDataUpdateRoutes(environment);
  const valid = { plugin: "local", operation: "query", arguments: {} };
  expect((await routes.dataUpdates(request([valid], false))).status).toBe(403);
  for (const resource of [
    { operation: "query", arguments: {} },
    { ...valid, plugin: "../local" },
    { ...valid, plugin: "local%2Fother" },
    { ...valid, operation: "../query" },
  ])
    expect((await routes.dataUpdates(request([resource]))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

test("resource count and actual body bytes are bounded before native subscription", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const routes = createDataUpdateRoutes(environment);
  const valid = { plugin: "synthetic", operation: "query", arguments: {} };
  expect((await routes.dataUpdates(request([]))).status).toBe(400);
  expect(
    (await routes.dataUpdates(request(Array.from({ length: 65 }, () => valid))))
      .status,
  ).toBe(400);
  expect(
    (
      await routes.dataUpdates(
        request([{ ...valid, arguments: { text: "é".repeat(33_000) } }]),
      )
    ).status,
  ).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});

test("downstream cancellation releases the native response stream", async () => {
  const cancelled = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel: cancelled }), {
          headers: { "content-type": "text/event-stream" },
        }),
    ),
  );
  const response = await createDataUpdateRoutes(environment).dataUpdates(
    request([{ plugin: "synthetic", operation: "query", arguments: {} }]),
  );
  await response.body?.cancel();
  expect(cancelled).toHaveBeenCalledOnce();
});
