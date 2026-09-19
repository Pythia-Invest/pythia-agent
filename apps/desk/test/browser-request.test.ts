import { afterEach, expect, test, vi } from "vitest";
import { DeskApi } from "../src/client/api";

afterEach(() => vi.unstubAllGlobals());

test("concurrent new reads and streams share one browser admission session", async () => {
  let release: (() => void) | undefined;
  const session = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: { path: string; token: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({
        path,
        token: new Headers(init?.headers).get("x-pythia-csrf"),
      });
      if (path === "/api/browser-session") {
        await session;
        return Response.json({ csrf_token: "same-session" });
      }
      if (path === "/api/data/updates")
        return new Response("", {
          headers: { "content-type": "text/event-stream" },
        });
      return Response.json({ data: "snapshot" });
    }),
  );
  const api = new DeskApi();
  const resource = { plugin: "synthetic", operation: "summary", arguments: {} };
  const read = api.pluginRead(resource);
  const stream = api
    .dataUpdates([resource], new AbortController().signal)
    .next();
  expect(calls).toEqual([{ path: "/api/browser-session", token: null }]);
  release?.();
  await Promise.all([read, stream]);
  expect(calls.slice(1)).toEqual(
    expect.arrayContaining([
      { path: "/api/data/read", token: "same-session" },
      { path: "/api/data/updates", token: "same-session" },
    ]),
  );
});
