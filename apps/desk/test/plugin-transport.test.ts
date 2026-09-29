import { afterEach, expect, test, vi } from "vitest";
import { createPluginTransport } from "../src/server/plugin-transport";

afterEach(() => vi.unstubAllGlobals());
test("shared and specialist operations use the authenticated profile route without command execution", async () => {
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _options?: RequestInit) =>
      new Response('{"schema_version":1,"outcome":"ok"}'),
  );
  vi.stubGlobal("fetch", fetcher);
  const call = createPluginTransport({
    NODE_ENV: "test",
    API_SERVER_KEY: "synthetic-gateway-key-123456789",
    PYTHIA_HERMES_API_URL: "http://127.0.0.1:8765",
    PYTHIA_HERMES_PROFILE: "research",
  });
  const signal = new AbortController().signal;
  await call(
    {
      plugin: "pythia-market-data",
      operation: "query",
      arguments: { action: "get_preferences" },
    },
    signal,
  );
  await call(
    {
      plugin: "synthetic-research",
      operation: "summary",
      arguments: {},
    },
    signal,
  );
  await call(
    {
      plugin: "research/local-feature",
      operation: "query",
      arguments: {},
      readOnly: true,
    },
    signal,
  );
  expect(fetcher.mock.calls.map((args) => args[0])).toEqual([
    "http://127.0.0.1:8765/p/research/v1/pythia/plugins/pythia-market-data/query",
    "http://127.0.0.1:8765/p/research/v1/pythia/plugins/synthetic-research/summary",
    "http://127.0.0.1:8765/p/research/v1/pythia/plugins/research%2Flocal-feature/query",
  ]);
  const options = fetcher.mock.calls[0]?.[1] as RequestInit;
  expect(new Headers(options.headers).get("authorization")).toBe(
    "Bearer synthetic-gateway-key-123456789",
  );
  expect(options.redirect).toBe("error");
  expect(JSON.parse(String(options.body))).toEqual({
    arguments: { action: "get_preferences" },
  });
  expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
    arguments: {},
    read_only: true,
  });
});

const configured = {
  NODE_ENV: "test",
  API_SERVER_KEY: "synthetic-gateway-key-123456789",
  PYTHIA_HERMES_API_URL: "http://127.0.0.1:8765",
  PYTHIA_HERMES_PROFILE: "research",
} as const;

test.each([
  [
    "missing auth",
    { API_SERVER_KEY: undefined },
    "local",
    "query",
    /not configured yet/,
  ],
  [
    "an external destination",
    { PYTHIA_HERMES_API_URL: "http://external.invalid:8765" },
    "local",
    "query",
    /loopback HTTP address/,
  ],
  [
    "a loopback address with a path",
    { PYTHIA_HERMES_API_URL: "http://127.0.0.1:8765/path" },
    "local",
    "query",
    /loopback HTTP address/,
  ],
  ["a traversing plugin", {}, "../runs", "query", /invalid_plugin/],
  ["an encoded plugin path", {}, "local%2Fruns", "query", /invalid_plugin/],
  ["a nested plugin path", {}, "a/b/c", "query", /invalid_plugin/],
  ["an empty plugin", {}, "", "query", /invalid_plugin/],
  ["a traversing operation", {}, "local", "../runs", /invalid_operation/],
  ["an empty operation", {}, "local", "", /invalid_operation/],
])(
  "%s fails before a request",
  async (_label, change, plugin, operation, error) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const call = createPluginTransport({ ...configured, ...change });
    await expect(
      call({ plugin, operation, arguments: {} }, new AbortController().signal),
    ).rejects.toThrow(error);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
